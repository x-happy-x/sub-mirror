import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
const SUB_URL_DEFAULT = process.env.SUB_URL || "";
const USE_CONVERTER_DEFAULT = process.env.USE_CONVERTER === "1";
const CONVERTER_URL = process.env.CONVERTER_URL || "";
const SOURCE_URL = process.env.SOURCE_URL || "http://web/source.txt";
const PORT = Number(process.env.PORT || "8787");

const OUT_RAW = "/data/raw.txt";
const OUT_YAML = "/data/subscription.yaml";
const OUT_STATUS = "/data/status.json";
const OUT_CONVERTED = "/data/converted.txt";
const SOURCE_PATH = "/data/source.txt";

function isHtml(s) {
  const t = s.trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function looksLikeClashProviderYaml(s) {
  return /^\s*proxies\s*:\s*$/m.test(s);
}

function looksLikeUriListOrBase64(s) {
  const t = s.trim();
  return (
    t.startsWith("vmess://") ||
    t.startsWith("vless://") ||
    t.startsWith("ss://") ||
    (/^[A-Za-z0-9+/=\r\n]+$/.test(t) && t.length > 200)
  );
}

function extractConvertibleSource(rawText) {
  const t = rawText.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return rawText;
  try {
    const parsed = JSON.parse(t);
    const cryptoLink = parsed?.happ?.cryptoLink;
    if (typeof cryptoLink === "string" && cryptoLink.trim()) {
      return cryptoLink.trim();
    }
  } catch {
    // ignore JSON parse errors; fall back to raw text
  }
  return rawText;
}

function decodeBase64IfNeeded(text) {
  const t = text.trim();
  if (t.includes("://")) return text;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(t) || t.length < 200) return text;
  try {
    const decoded = Buffer.from(t.replace(/\s+/g, ""), "base64").toString("utf8");
    return decoded && decoded.trim() ? decoded : text;
  } catch {
    return text;
  }
}

function extractVlessLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("vless://"));
}

function buildYaml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(obj)) {
    return obj
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const head = `${pad}-`;
          const body = buildYaml(item, indent + 1);
          return body ? `${head}\n${body}` : head;
        }
        return `${pad}- ${String(item)}`;
      })
      .join("\n");
  }
  if (typeof obj !== "object" || obj === null) {
    return `${pad}${String(obj)}`;
  }
  return Object.entries(obj)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${pad}${key}:\n${buildYaml(value, indent + 1)}`;
      }
      if (typeof value === "object" && value !== null) {
        const body = buildYaml(value, indent + 1);
        return body ? `${pad}${key}:\n${body}` : `${pad}${key}: {}`;
      }
      return `${pad}${key}: ${String(value)}`;
    })
    .join("\n");
}

function vlessToProxy(line) {
  const url = new URL(line);
  const params = url.searchParams;
  const name = decodeURIComponent(url.hash.replace(/^#/, "")) || `${url.hostname}:${url.port || 443}`;
  const network = params.get("type") || "tcp";
  const security = params.get("security") || "none";
  const proxy = {
    name: JSON.stringify(name),
    type: "vless",
    server: url.hostname,
    port: Number(url.port || 443),
    uuid: url.username,
    udp: true,
  };

  if (network && network !== "tcp") proxy.network = network;
  if (security && security !== "none") proxy.tls = true;

  const sni = params.get("sni");
  if (sni) proxy.servername = sni;

  const fp = params.get("fp");
  if (fp) proxy["client-fingerprint"] = fp;

  const flow = params.get("flow");
  if (flow) proxy.flow = flow;

  if (security === "reality") {
    const pbk = params.get("pbk");
    const sid = params.get("sid");
    const reality = {};
    if (pbk) reality["public-key"] = pbk;
    if (sid) reality["short-id"] = sid;
    if (Object.keys(reality).length) proxy["reality-opts"] = reality;
  }

  if (network === "ws") {
    const path = params.get("path");
    const host = params.get("host");
    const ws = {};
    if (path) ws.path = path;
    if (host) ws.headers = { Host: host };
    if (Object.keys(ws).length) proxy["ws-opts"] = ws;
  }

  if (network === "xhttp") {
    const path = params.get("path");
    const host = params.get("host");
    const mode = params.get("mode");
    const httpOpts = {};
    if (path) httpOpts.path = [path];
    if (host) httpOpts.headers = { Host: [host] };
    if (mode) httpOpts.mode = mode;
    if (Object.keys(httpOpts).length) {
      proxy.network = "http";
      proxy["http-opts"] = httpOpts;
    }
  }

  return proxy;
}

function convertVlessListToClash(text) {
  const lines = extractVlessLines(text);
  if (lines.length === 0) return null;
  const proxies = lines.map(vlessToProxy);
  const yaml = `proxies:\n${buildYaml(proxies, 1)}`;
  return yaml;
}

function writeStatus(obj) {
  fs.writeFileSync(OUT_STATUS, JSON.stringify(obj, null, 2));
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function firstHeaderValue(v) {
  if (Array.isArray(v)) return v[0];
  if (typeof v !== "string") return v;
  const first = v.split(",")[0];
  return first ? first.trim() : v;
}

function parseBool(v, fallback = false) {
  const value = firstHeaderValue(v);
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function pickSubUrl(reqUrl, reqHeaders) {
  const subFromQuery = reqUrl.searchParams.get("sub_url");
  const subFromHeader = firstHeaderValue(reqHeaders["x-sub-url"]);
  return subFromQuery || subFromHeader || SUB_URL_DEFAULT;
}

function pickUseConverter(reqUrl, reqHeaders) {
  const fromQuery = reqUrl.searchParams.get("use_converter");
  const fromHeader = reqHeaders["x-use-converter"];
  return parseBool(fromQuery ?? fromHeader, USE_CONVERTER_DEFAULT);
}

function sanitizeForwardHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (key === "host" || key === "connection" || key === "content-length") continue;
    if (key === "x-sub-url" || key === "x-use-converter") continue;
    const value = firstHeaderValue(v);
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}

function happHeaders() {
  return {
    "user-agent": "Happ/1.0.1/Windows",
    "x-device-locale": "RU",
    "x-device-os": "Windows",
    "x-device-model": "PC-X_x86_64",
    "x-hwid": "648de419-b18e-4fe9-8bfa-a5d5e2784928",
    "x-ver-os": "11_10.0.28000",
    "accept-language": "ru-RU,en,*",
    "accept-encoding": "gzip, deflate",
    connection: "Keep-Alive",
  };
}

async function convertViaSubconverter(rawText) {
  if (!CONVERTER_URL) {
    throw new Error("CONVERTER_URL is not set");
  }
  fs.writeFileSync(SOURCE_PATH, rawText);

  const target = "clash";
  const finalUrl = `${CONVERTER_URL}?target=${encodeURIComponent(target)}&url=${encodeURIComponent(
    SOURCE_URL,
  )}&list=true`;

  const res = await fetch(finalUrl);
  const text = await res.text();
  fs.writeFileSync(OUT_CONVERTED, text);
  return text;
}

async function fetchWithNode(subUrl, forwardHeaders) {
  const resp = await fetch(subUrl, {
    headers: forwardHeaders,
    redirect: "follow",
  });
  const body = await resp.text();
  const responseHeaders = Object.fromEntries(resp.headers.entries());
  const responseStatus = resp.status;
  const responseUrl = resp.url;
  return { body, responseHeaders, responseStatus, responseUrl };
}

async function handleSubscription(req, res, mode = "passthrough") {
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const subUrl = pickSubUrl(reqUrl, req.headers);
  const useConverter = pickUseConverter(reqUrl, req.headers);

  if (!subUrl) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("SUB_URL is required (use ?sub_url= or X-Sub-Url header)");
    return;
  }

  const startedAt = new Date().toISOString();
  try {
    const forwardHeaders =
      mode === "happ" ? happHeaders() : sanitizeForwardHeaders(req.headers);
    const fetched = await fetchWithNode(subUrl, forwardHeaders);
    const raw = fetched.body;

    fs.writeFileSync(OUT_RAW, raw);

    if (!raw || raw.trim().length === 0) {
      writeStatus({
        ok: false,
        startedAt,
        error: "empty response",
        subUrl,
        useConverter,
        responseStatus: fetched.responseStatus,
        responseUrl: fetched.responseUrl,
        responseHeaders: fetched.responseHeaders,
      });
      throw new Error("empty response");
    }

    if (isHtml(raw)) {
      writeStatus({
        ok: false,
        startedAt,
        error: "got HTML (anti-bot page)",
        subUrl,
        useConverter,
        responseStatus: fetched.responseStatus,
        responseUrl: fetched.responseUrl,
        responseHeaders: fetched.responseHeaders,
        sha1: sha1(raw),
      });
      throw new Error("got HTML (anti-bot page)");
    }

    let out = raw;
    let conversion = "none";

    if (looksLikeClashProviderYaml(raw)) {
      // already suitable
    } else {
      let convertible = extractConvertibleSource(raw);
      if (looksLikeUriListOrBase64(convertible)) {
        convertible = decodeBase64IfNeeded(convertible);
      }

      if (useConverter) {
        out = await convertViaSubconverter(convertible);
        conversion = "subconverter";
      }

      if (!looksLikeClashProviderYaml(out)) {
        const fallback = convertVlessListToClash(convertible);
        if (fallback) {
          out = fallback;
          conversion = "vless-fallback";
        }
      }
    }

    if (!looksLikeClashProviderYaml(out)) {
      writeStatus({
        ok: false,
        startedAt,
        error: "output has no proxies:",
        subUrl,
        useConverter,
        responseStatus: fetched.responseStatus,
        responseUrl: fetched.responseUrl,
        responseHeaders: fetched.responseHeaders,
        outputSha1: sha1(out),
        conversion,
      });
      throw new Error("output has no proxies:");
    }

    fs.writeFileSync(`${OUT_YAML}.tmp`, out);
    fs.renameSync(`${OUT_YAML}.tmp`, OUT_YAML);

    writeStatus({
      ok: true,
      startedAt,
      saved: OUT_YAML,
      sha1: sha1(out),
      bytes: out.length,
      subUrl,
      useConverter,
      responseStatus: fetched.responseStatus,
      responseUrl: fetched.responseUrl,
      responseHeaders: fetched.responseHeaders,
      forwardedHeaders: forwardHeaders,
      conversion,
    });

    res.writeHead(200, {
      "Content-Type": "text/yaml; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(out);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`failed to fetch subscription: ${e?.message || e}`);
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (req.method === "GET" && path === "/subscription.yaml") {
    void handleSubscription(req, res);
    return;
  }
  if (req.method === "GET" && path === "/happ.sub.yaml") {
    void handleSubscription(req, res, "happ");
    return;
  }
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] listening on :${PORT}`);
});
