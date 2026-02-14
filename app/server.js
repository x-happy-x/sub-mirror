import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
const SUB_URL_DEFAULT = process.env.SUB_URL || "";
const USE_CONVERTER_DEFAULT = process.env.USE_CONVERTER === "1";
const CONVERTER_URL = process.env.CONVERTER_URL || "";
const SOURCE_URL = process.env.SOURCE_URL || "http://web/source.txt";
const PORT = Number(process.env.PORT || "8787");
const PROFILE_DIR_ENV = process.env.PROFILE_DIR || "";
const PROFILE_FALLBACK_DIR = path.resolve(process.cwd(), "profiles");
const PROFILE_DIRS = PROFILE_DIR_ENV
  ? [PROFILE_DIR_ENV]
  : ["/data/profiles", PROFILE_FALLBACK_DIR];
const HEADER_POLICY_DEFAULT = "prefer_request";

const OUT_RAW = "/data/raw.txt";
const OUT_YAML = "/data/subscription.yaml";
const OUT_STATUS = "/data/status.json";
const OUT_CONVERTED = "/data/converted.txt";
const SOURCE_PATH = "/data/source.txt";
const CACHE_DIR = "/data/cache";
const STATIC_FILES = new Map([
  ["/raw.txt", { path: OUT_RAW, type: "text/plain; charset=utf-8" }],
  ["/status.json", { path: OUT_STATUS, type: "application/json; charset=utf-8" }],
  ["/converted.txt", { path: OUT_CONVERTED, type: "text/plain; charset=utf-8" }],
  ["/source.txt", { path: SOURCE_PATH, type: "text/plain; charset=utf-8" }],
]);
const RANDOM_PROFILE_TEMPLATES = [
  {
    id: "linux-notebook",
    deviceModel: "anastasia-HP-255-G8-Notebook-PC_x86_64",
    os: "Linux",
    osVersion: "ubuntu_22.04",
    connectedAt: "24.01.2026 12:12",
    userAgent: "Happ/2.0.1/Linux",
    hwid: "800004fdfd6641f3a595c2dd455bfa8a",
  },
  {
    id: "aqm-lx1",
    deviceModel: "AQM-LX1",
    os: "Android",
    osVersion: "10",
    connectedAt: "24.01.2026 12:09",
    userAgent: "Happ/3.3.4",
    hwid: "0943e686eec9f55e",
  },
  {
    id: "2509fpn0bc",
    deviceModel: "2509FPN0BC",
    os: "Android",
    osVersion: "16",
    connectedAt: "18.01.2026 17:50",
    userAgent: "Happ/3.10.0",
    hwid: "ab9a20e5bc21d63e",
  },
  {
    id: "iphone-13-mini",
    deviceModel: "iPhone 13 mini",
    os: "iOS",
    osVersion: "26.1",
    connectedAt: "09.01.2026 17:21",
    userAgent: "Happ/3.5.2/ios CFNetwork/3860.200.71 Darwin/25.1.0",
    hwid: "bd6d054bb05c1775",
  },
  {
    id: "pc-x-x86-64",
    deviceModel: "PC-X_x86_64",
    os: "Windows",
    osVersion: "11_10.0.28000",
    connectedAt: "30.11.2025 14:56",
    userAgent: "Happ/1.0.1/Windows",
    hwid: "648de419-b18e-4fe9-8bfa-a5d5e2784928",
  },
];

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

function hasAnySubscriptions(text) {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeClashProviderYaml(t)) {
    return /-\s*name\s*:/m.test(t);
  }
  const decoded = looksLikeUriListOrBase64(t) ? decodeBase64IfNeeded(t) : t;
  const prefixes = ["vless://", "vmess://", "ss://", "ssr://", "trojan://"];
  return decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && prefixes.some((prefix) => line.startsWith(prefix))).length > 0;
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

function logRequest(info) {
  const entry = { ts: new Date().toISOString(), ...info };
  console.log(JSON.stringify(entry));
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheKey(subUrl, useConverter, profileKey = "") {
  return sha1(`${subUrl}|${useConverter ? "1" : "0"}|${profileKey}`);
}

function cachePathForKey(key) {
  return `${CACHE_DIR}/${key}.yaml`;
}

function cacheMetaPathForKey(key) {
  return `${CACHE_DIR}/${key}.json`;
}

function writeCacheMeta(key, meta) {
  fs.writeFileSync(cacheMetaPathForKey(key), JSON.stringify(meta, null, 2));
}

function serveStaticFile(res, entry) {
  try {
    const body = fs.readFileSync(entry.path);
    res.writeHead(200, {
      "Content-Type": entry.type,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("failed to read file");
  }
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

function sanitizeForwardHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (key === "host" || key === "connection" || key === "content-length") continue;
    if (
      key === "x-sub-url" ||
      key === "x-use-converter" ||
      key === "x-profile" ||
      key === "x-profiles"
    ) {
      continue;
    }
    const value = firstHeaderValue(v);
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}

function parseOptionalBool(v) {
  const value = firstHeaderValue(v);
  if (value === undefined || value === null || value === "") return undefined;
  return parseBool(value, false);
}

function randomHex(length) {
  const bytes = crypto.randomBytes(Math.ceil(length / 2)).toString("hex");
  return bytes.slice(0, length);
}

function randomUuidV4() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomHwidLike(sample) {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sample)) {
    return randomUuidV4();
  }
  if (/^[0-9a-fA-F]+$/.test(sample)) {
    return randomHex(sample.length);
  }
  return randomHex(16);
}

function pickRandomTemplate() {
  const index = Math.floor(Math.random() * RANDOM_PROFILE_TEMPLATES.length);
  return RANDOM_PROFILE_TEMPLATES[index];
}

function buildRandomProfilePayload(reqUrl) {
  const templateId = reqUrl.searchParams.get("template");
  const template = templateId
    ? RANDOM_PROFILE_TEMPLATES.find((item) => item.id === templateId)
    : pickRandomTemplate();
  if (!template) {
    return {
      ok: false,
      status: 400,
      error: `unknown template: ${templateId}`,
    };
  }
  const fixedHwid = parseBool(reqUrl.searchParams.get("fixed_hwid"), false);
  const profileName =
    reqUrl.searchParams.get("name") ||
    `${template.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const profile = {
    sub_url: "",
    use_converter: true,
    header_policy: "file_only",
    allow_hwid_override: !fixedHwid,
    headers: {
      "user-agent": template.userAgent,
      "x-device-os": template.os,
      "x-ver-os": template.osVersion,
      "x-device-model": template.deviceModel,
      "x-device-locale": "en-US",
      "x-hwid": fixedHwid ? template.hwid : randomHwidLike(template.hwid),
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate",
    },
    required_headers: [],
  };
  const profileYaml = buildYaml(profile);
  return {
    ok: true,
    template,
    profileName,
    profile,
    profileYaml,
  };
}

function unquoteYamlValue(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'");
  }
  return value;
}

function parseProfileYaml(content) {
  const profile = {
    subUrl: "",
    useConverter: undefined,
    headerPolicy: HEADER_POLICY_DEFAULT,
    allowHwidOverride: true,
    headers: {},
    requiredHeaders: [],
  };
  let section = "";
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const raw = line.replace(/\t/g, "  ");
    const commentCut = raw.indexOf("#");
    const cleaned = commentCut >= 0 ? raw.slice(0, commentCut) : raw;
    const trimmed = cleaned.trim();
    if (!trimmed) continue;

    const indent = cleaned.match(/^ */)?.[0].length ?? 0;
    if (indent === 0) {
      section = "";
      const keyMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
      if (!keyMatch) continue;
      const key = keyMatch[1];
      const value = unquoteYamlValue((keyMatch[2] || "").trim());

      if (key === "sub_url") {
        profile.subUrl = value;
      } else if (key === "use_converter") {
        if (value !== "") profile.useConverter = parseBool(value, false);
      } else if (key === "header_policy") {
        if (value) profile.headerPolicy = value.toLowerCase();
      } else if (key === "allow_hwid_override") {
        if (value !== "") profile.allowHwidOverride = parseBool(value, true);
      } else if (key === "headers" || key === "required_headers") {
        section = key;
      }
      continue;
    }

    if (section === "headers") {
      const pair = trimmed.match(/^([A-Za-z0-9-]+)\s*:\s*(.*)$/);
      if (!pair) continue;
      profile.headers[pair[1].toLowerCase()] = unquoteYamlValue((pair[2] || "").trim());
      continue;
    }

    if (section === "required_headers") {
      const item = trimmed.match(/^-\s*(.+)$/);
      if (!item) continue;
      profile.requiredHeaders.push(unquoteYamlValue(item[1].trim()).toLowerCase());
    }
  }
  return profile;
}

function readProfileFile(profileName) {
  for (const dir of PROFILE_DIRS) {
    const ymlPath = path.join(dir, `${profileName}.yml`);
    const yamlPath = path.join(dir, `${profileName}.yaml`);
    let filePath = "";
    if (fs.existsSync(ymlPath)) filePath = ymlPath;
    else if (fs.existsSync(yamlPath)) filePath = yamlPath;
    if (!filePath) continue;
    const content = fs.readFileSync(filePath, "utf8");
    return parseProfileYaml(content);
  }
  return null;
}

function pickProfileNames(reqUrl, reqHeaders, forcedProfileName = "") {
  const rawNames = [
    ...reqUrl.searchParams.getAll("profile"),
    ...reqUrl.searchParams.getAll("profiles"),
    firstHeaderValue(reqHeaders["x-profile"]) || "",
    firstHeaderValue(reqHeaders["x-profiles"]) || "",
  ];
  if (forcedProfileName) {
    rawNames.push(forcedProfileName);
  }
  const out = [];
  for (const raw of rawNames) {
    for (const part of String(raw || "").split(",")) {
      const name = part.trim();
      if (!name) continue;
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

function mergeProfiles(profileNames) {
  const merged = {
    subUrl: "",
    useConverter: undefined,
    headerPolicy: HEADER_POLICY_DEFAULT,
    allowHwidOverride: true,
    headers: {},
    requiredHeaders: [],
  };
  for (const name of profileNames) {
    const profile = readProfileFile(name);
    if (!profile) {
      return { ok: false, error: `profile not found: ${name}` };
    }
    if (profile.subUrl) merged.subUrl = profile.subUrl;
    if (profile.useConverter !== undefined) merged.useConverter = profile.useConverter;
    if (profile.headerPolicy) merged.headerPolicy = profile.headerPolicy;
    merged.allowHwidOverride = profile.allowHwidOverride !== false;
    merged.headers = { ...merged.headers, ...profile.headers };
    for (const key of profile.requiredHeaders) {
      if (!merged.requiredHeaders.includes(key)) merged.requiredHeaders.push(key);
    }
  }
  const validPolicies = new Set(["prefer_request", "file_only", "require_request"]);
  if (!validPolicies.has(merged.headerPolicy)) {
    return { ok: false, error: `unsupported header_policy: ${merged.headerPolicy}` };
  }
  return { ok: true, profile: merged };
}

function resolveForwardHeaders(reqHeaders, profile, hwidOverride) {
  const incoming = sanitizeForwardHeaders(reqHeaders);
  const fromProfile = { ...profile.headers };
  if (hwidOverride && profile.allowHwidOverride !== false) {
    fromProfile["x-hwid"] = hwidOverride;
  }

  if (profile.headerPolicy === "require_request") {
    for (const required of profile.requiredHeaders) {
      if (!incoming[required]) {
        return { ok: false, error: `required header is missing: ${required}` };
      }
    }
  }

  if (profile.headerPolicy === "file_only") {
    return { ok: true, headers: { ...incoming, ...fromProfile } };
  }
  return { ok: true, headers: { ...fromProfile, ...incoming } };
}

function resolveRequestConfig(reqUrl, reqHeaders, forcedProfileName = "") {
  const profileNames = pickProfileNames(reqUrl, reqHeaders, forcedProfileName);
  const merged = mergeProfiles(profileNames);
  if (!merged.ok) {
    return { ok: false, status: 400, error: merged.error };
  }

  const subFromQuery = reqUrl.searchParams.get("sub_url");
  const subFromHeader = firstHeaderValue(reqHeaders["x-sub-url"]);
  const subUrl = subFromQuery || subFromHeader || merged.profile.subUrl || SUB_URL_DEFAULT;

  const fromQuery = reqUrl.searchParams.get("use_converter");
  const fromHeader = reqHeaders["x-use-converter"];
  const explicitUseConverter = parseOptionalBool(fromQuery ?? fromHeader);
  const useConverter =
    explicitUseConverter ??
    (merged.profile.useConverter !== undefined ? merged.profile.useConverter : USE_CONVERTER_DEFAULT);

  const hwidOverride =
    reqUrl.searchParams.get("hwid") ?? firstHeaderValue(reqHeaders["x-hwid"]);
  const resolvedHeaders = resolveForwardHeaders(reqHeaders, merged.profile, hwidOverride);
  if (!resolvedHeaders.ok) {
    return { ok: false, status: 400, error: resolvedHeaders.error };
  }

  return {
    ok: true,
    subUrl,
    useConverter,
    profileNames,
    forwardHeaders: resolvedHeaders.headers,
  };
}

function sanitizeUpstreamResponseHeaders(headers) {
  const out = {};
  const blocked = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-encoding",
    "content-type",
  ]);
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null) continue;
    const key = k.toLowerCase();
    if (blocked.has(key)) continue;
    out[key] = String(v);
  }
  return out;
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

async function refreshCache(subUrl, useConverter, profileNames, forwardHeaders) {
  const fetched = await fetchWithNode(subUrl, forwardHeaders);
  const raw = fetched.body;
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "empty response" };
  }
  if (isHtml(raw)) {
    return { ok: false, error: "got HTML (anti-bot page)" };
  }

  let out = raw;
  if (!looksLikeClashProviderYaml(raw)) {
    let convertible = extractConvertibleSource(raw);
    if (looksLikeUriListOrBase64(convertible)) {
      convertible = decodeBase64IfNeeded(convertible);
    }

    if (useConverter) {
      out = await convertViaSubconverter(convertible);
      if (!looksLikeClashProviderYaml(out)) {
        const fallback = convertVlessListToClash(convertible);
        if (fallback) {
          out = fallback;
        }
      }
    }
  }

  const isYaml = looksLikeClashProviderYaml(out);
  if (!isYaml && useConverter) {
    return { ok: false, error: "output has no proxies" };
  }

  if (!hasAnySubscriptions(out)) {
    return { ok: false, error: "no subscriptions" };
  }

  const contentType = isYaml ? "text/yaml; charset=utf-8" : "text/plain; charset=utf-8";
  const upstreamHeaders = sanitizeUpstreamResponseHeaders(fetched.responseHeaders);
  ensureCacheDir();
  const cacheKeyValue = cacheKey(subUrl, useConverter, profileNames.join(","));
  const cachePath = cachePathForKey(cacheKeyValue);
  fs.writeFileSync(`${cachePath}.tmp`, out);
  fs.renameSync(`${cachePath}.tmp`, cachePath);
  writeCacheMeta(cacheKeyValue, { contentType, responseHeaders: upstreamHeaders });
  return { ok: true, body: out, contentType, responseHeaders: upstreamHeaders };
}

async function handleSubscription(req, res, forcedProfileName = "") {
  const startedAtMs = Date.now();
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const config = resolveRequestConfig(reqUrl, req.headers, forcedProfileName);
  const useConverter = config.ok ? config.useConverter : USE_CONVERTER_DEFAULT;

  if (!config.ok) {
    res.writeHead(config.status || 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(config.error || "invalid request");
    logRequest({
      route: "/sub",
      status: config.status || 400,
      profiles: forcedProfileName ? [forcedProfileName] : [],
      useConverter,
      durationMs: Date.now() - startedAtMs,
      error: config.error || "invalid request",
    });
    return;
  }

  const { subUrl, profileNames, forwardHeaders } = config;

  if (!subUrl) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("SUB_URL is required (use ?sub_url= or X-Sub-Url header)");
    logRequest({
      route: "/sub",
      status: 400,
      profiles: profileNames,
      useConverter,
      durationMs: Date.now() - startedAtMs,
      error: "missing sub_url",
    });
    return;
  }

  const startedAt = new Date().toISOString();
  try {
    const fetched = await fetchWithNode(subUrl, forwardHeaders);
    const raw = fetched.body;
    const upstreamHeaders = sanitizeUpstreamResponseHeaders(fetched.responseHeaders);

    fs.writeFileSync(OUT_RAW, raw);

    if (!raw || raw.trim().length === 0) {
      writeStatus({
        ok: false,
        startedAt,
        error: "empty response",
        subUrl,
        useConverter,
        profiles: profileNames,
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
        profiles: profileNames,
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

        if (!looksLikeClashProviderYaml(out)) {
          const fallback = convertVlessListToClash(convertible);
          if (fallback) {
            out = fallback;
            conversion = "vless-fallback";
          }
        }
      }
    }

    const isYaml = looksLikeClashProviderYaml(out);
    if (!isYaml && !useConverter) {
      ensureCacheDir();
      const cacheKeyValue = cacheKey(subUrl, useConverter, profileNames.join(","));
      const cachePath = cachePathForKey(cacheKeyValue);
      fs.writeFileSync(`${cachePath}.tmp`, out);
      fs.renameSync(`${cachePath}.tmp`, cachePath);
      writeCacheMeta(cacheKeyValue, {
        contentType: "text/plain; charset=utf-8",
        responseHeaders: upstreamHeaders,
      });

      writeStatus({
        ok: true,
        startedAt,
        saved: OUT_RAW,
        cached: cachePath,
        sha1: sha1(out),
        bytes: out.length,
        subUrl,
        useConverter,
        profiles: profileNames,
        responseStatus: fetched.responseStatus,
        responseUrl: fetched.responseUrl,
        responseHeaders: fetched.responseHeaders,
        forwardedHeaders: forwardHeaders,
        conversion: "none-raw",
      });

      res.writeHead(200, {
        ...upstreamHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(out);
      logRequest({
        route: "/sub",
        status: 200,
        profiles: profileNames,
        useConverter,
        contentType: "text/plain; charset=utf-8",
        responseStatus: fetched.responseStatus,
        conversion: "none-raw",
        bytes: out.length,
        durationMs: Date.now() - startedAtMs,
      });
      return;
    }

    if (!isYaml) {
      writeStatus({
        ok: false,
        startedAt,
        error: "output has no proxies:",
        subUrl,
        useConverter,
        profiles: profileNames,
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
    ensureCacheDir();
    const cacheKeyValue = cacheKey(subUrl, useConverter, profileNames.join(","));
    const cachePath = cachePathForKey(cacheKeyValue);
    fs.writeFileSync(`${cachePath}.tmp`, out);
    fs.renameSync(`${cachePath}.tmp`, cachePath);
    writeCacheMeta(cacheKeyValue, {
      contentType: "text/yaml; charset=utf-8",
      responseHeaders: upstreamHeaders,
    });

    writeStatus({
      ok: true,
      startedAt,
      saved: OUT_YAML,
      cached: cachePath,
      sha1: sha1(out),
      bytes: out.length,
      subUrl,
      useConverter,
      profiles: profileNames,
      responseStatus: fetched.responseStatus,
      responseUrl: fetched.responseUrl,
      responseHeaders: fetched.responseHeaders,
      forwardedHeaders: forwardHeaders,
      conversion,
    });

    res.writeHead(200, {
      ...upstreamHeaders,
      "Content-Type": "text/yaml; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(out);
    logRequest({
      route: "/sub",
      status: 200,
      profiles: profileNames,
      useConverter,
      contentType: "text/yaml; charset=utf-8",
      responseStatus: fetched.responseStatus,
      conversion,
      bytes: out.length,
      durationMs: Date.now() - startedAtMs,
    });
  } catch (e) {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`failed to fetch subscription: ${e?.message || e}`);
    logRequest({
      route: "/sub",
      status: 502,
      profiles: profileNames,
      useConverter,
      durationMs: Date.now() - startedAtMs,
      error: e?.message || String(e),
    });
  }
}

async function handleLast(req, res, forcedProfileName = "") {
  const startedAtMs = Date.now();
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const config = resolveRequestConfig(reqUrl, req.headers, forcedProfileName);
  const useConverter = config.ok ? config.useConverter : USE_CONVERTER_DEFAULT;

  if (!config.ok) {
    res.writeHead(config.status || 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(config.error || "invalid request");
    logRequest({
      route: "/last",
      status: config.status || 400,
      profiles: forcedProfileName ? [forcedProfileName] : [],
      useConverter,
      durationMs: Date.now() - startedAtMs,
      error: config.error || "invalid request",
    });
    return;
  }

  const { subUrl, profileNames, forwardHeaders } = config;

  if (!subUrl) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("SUB_URL is required (use ?sub_url= or X-Sub-Url header)");
    logRequest({
      route: "/last",
      status: 400,
      profiles: profileNames,
      useConverter,
      durationMs: Date.now() - startedAtMs,
      error: "missing sub_url",
    });
    return;
  }

  let refreshed = null;
  try {
    refreshed = await refreshCache(subUrl, useConverter, profileNames, forwardHeaders);
  } catch {
    refreshed = null;
  }
  if (refreshed && refreshed.ok) {
    res.writeHead(200, {
      ...refreshed.responseHeaders,
      "Content-Type": refreshed.contentType,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(refreshed.body);
    logRequest({
      route: "/last",
      status: 200,
      profiles: profileNames,
      useConverter,
      cache: "refreshed",
      contentType: refreshed.contentType,
      bytes: refreshed.body.length,
      durationMs: Date.now() - startedAtMs,
    });
    return;
  }
  if (refreshed && !refreshed.ok) {
    logRequest({
      route: "/last",
      status: 200,
      profiles: profileNames,
      useConverter,
      cache: "refresh-failed",
      durationMs: Date.now() - startedAtMs,
      error: refreshed.error,
    });
  }

  const key = cacheKey(subUrl, useConverter, profileNames.join(","));
  const path = cachePathForKey(key);
  try {
    let contentType = "text/yaml; charset=utf-8";
    let responseHeaders = {};
    try {
      const meta = JSON.parse(fs.readFileSync(cacheMetaPathForKey(key), "utf8"));
      if (meta && typeof meta.contentType === "string") {
        contentType = meta.contentType;
      }
      if (meta && typeof meta.responseHeaders === "object" && meta.responseHeaders) {
        responseHeaders = meta.responseHeaders;
      }
    } catch {
      // ignore missing/invalid metadata
    }
    const body = fs.readFileSync(path);
    res.writeHead(200, {
      ...responseHeaders,
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
    if (!refreshed || refreshed.ok !== true) {
      logRequest({
        route: "/last",
        status: 200,
        profiles: profileNames,
        useConverter,
        cache: "hit",
        contentType,
        bytes: body.length,
        durationMs: Date.now() - startedAtMs,
      });
    }
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("no cached subscription for provided parameters");
      logRequest({
        route: "/last",
        status: 404,
        profiles: profileNames,
        useConverter,
        cache: "miss",
        durationMs: Date.now() - startedAtMs,
      });
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("failed to read cached subscription");
    logRequest({
      route: "/last",
      status: 500,
      profiles: profileNames,
      useConverter,
      durationMs: Date.now() - startedAtMs,
      error: err?.message || String(err),
    });
  }
}

async function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`request body too large (max ${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleEcho(req, res) {
  const reqUrl = new URL(req.url || "/", "http://localhost");
  try {
    const rawBody = await readRequestBody(req);
    const bodyText = rawBody.toString("utf8");
    const query = {};
    for (const [k, v] of reqUrl.searchParams.entries()) {
      if (query[k] === undefined) {
        query[k] = v;
      } else if (Array.isArray(query[k])) {
        query[k].push(v);
      } else {
        query[k] = [query[k], v];
      }
    }
    const payload = {
      ok: true,
      method: req.method || "GET",
      path: reqUrl.pathname,
      query,
      headers: req.headers,
      body: bodyText,
      bodyBase64: rawBody.toString("base64"),
      bodyBytes: rawBody.length,
    };
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(payload, null, 2));
  } catch (e) {
    res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(e?.message || "failed to read request body");
  }
}

function handleRandomProfile(req, res) {
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const built = buildRandomProfilePayload(reqUrl);
  if (!built.ok) {
    res.writeHead(built.status || 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(built.error || "failed to generate profile");
    return;
  }
  const format = (reqUrl.searchParams.get("format") || "json").toLowerCase();
  const shouldSave = parseBool(reqUrl.searchParams.get("save"), false);
  let savedPath = "";
  if (shouldSave) {
    const safeName = built.profileName.replace(/[^a-zA-Z0-9._-]/g, "-");
    fs.mkdirSync(PROFILE_FALLBACK_DIR, { recursive: true });
    savedPath = path.join(PROFILE_FALLBACK_DIR, `${safeName}.yml`);
    fs.writeFileSync(savedPath, `${built.profileYaml}\n`);
  }
  if (format === "yml" || format === "yaml") {
    res.writeHead(200, {
      "Content-Type": "text/yaml; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    if (savedPath) {
      res.end(`${built.profileYaml}\n# saved_to: ${savedPath}`);
      return;
    }
    res.end(built.profileYaml);
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(
    JSON.stringify(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        template: built.template,
        profileName: built.profileName,
        savedPath: savedPath || undefined,
        profile: built.profile,
        yml: built.profileYaml,
      },
      null,
      2,
    ),
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  if (req.method === "GET" && path === "/sub") {
    void handleSubscription(req, res);
    return;
  }
  if (req.method === "GET" && path === "/last") {
    void handleLast(req, res);
    return;
  }
  if (req.method === "GET" && path === "/subscription.yaml") {
    void handleSubscription(req, res);
    return;
  }
  if (path === "/debug/echo") {
    void handleEcho(req, res);
    return;
  }
  if (req.method === "GET" && path === "/profile/random") {
    handleRandomProfile(req, res);
    return;
  }
  const staticEntry = STATIC_FILES.get(path);
  if (req.method === "GET" && staticEntry) {
    serveStaticFile(res, staticEntry);
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
