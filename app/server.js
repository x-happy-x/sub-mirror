import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_SESSION_TTL_SEC,
  CACHE_DIR,
  PORT,
  PUBLIC_BASE_URL,
  STATIC_FILES,
  normalizeOutput,
} from "./config.js";
import { renderHomePage } from "./home-page.js";
import {
  PARAM_KEYS,
  sanitizeParams,
  createShortLink,
  getShortLink,
  updateShortLink,
  buildQueryFromParams,
} from "./short-links.js";
import {
  createAuthSessionForUser,
  getAuthSession,
  deleteAuthSession,
  incrementShortLinkHits,
  hasUsers,
  verifyUserCredentials,
  listUsers as listAuthUsers,
  createUser as createAuthUser,
  updateUser as updateAuthUser,
  deleteUser as deleteAuthUser,
  getFavoritesRow,
  setFavoritesRow,
  recordShortLinkUserVisit,
  listShortLinkUsers,
  updateShortLinkUserPolicy,
  setShortLinkUserBlocked,
  deleteShortLinkUser,
} from "./sqlite-store.js";
import {
  createMockSource,
  getMockSource,
  updateMockSource,
  appendMockLog,
  clearMockLogs,
  listPresets,
} from "./mock-sources.js";
import {
  listEditorCatalog,
  readProfileForEdit,
  saveProfileForEdit,
  deleteProfileForEdit,
} from "./profile-editor.js";
import {
  parseProfileYaml,
  getUaCatalogOptions,
  readProfileFile,
  profileExists,
  pickUserAgentProfile,
  resolveRequestConfig,
  produceOutput,
  fetchWithNode,
  handleSubscription,
  handleLast,
  handleEcho,
  serveStaticFile,
} from "./subscription.js";
import { getAppsCatalog, getAppGuide } from "./apps-catalog.js";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST_CANDIDATES = [
  path.resolve(SERVER_DIR, "../frontend-dist"),
  path.resolve(SERVER_DIR, "../frontend/dist"),
];

function resolveFrontendDist() {
  for (const dir of FRONTEND_DIST_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return "";
}

const FRONTEND_DIST = resolveFrontendDist();

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".map") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveFile(res, filePath) {
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypeForFile(filePath),
      "Cache-Control": "no-store",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function serveFrontendIndex(res) {
  if (!FRONTEND_DIST) return false;
  return serveFile(res, path.join(FRONTEND_DIST, "index.html"));
}

function serveFrontendAsset(reqPath, res) {
  if (!FRONTEND_DIST) return false;
  const decodedPath = decodeURIComponent(reqPath || "/");
  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const absolute = path.resolve(FRONTEND_DIST, `.${normalized}`);
  if (!absolute.startsWith(FRONTEND_DIST)) return false;
  if (!fs.existsSync(absolute)) return false;
  if (!fs.statSync(absolute).isFile()) return false;
  return serveFile(res, absolute);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function parseBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

async function resolveAuthToken(req) {
  const cookieToken = parseCookies(req).sub_auth || "";
  const headerToken = String(req.headers["x-auth-token"] || "").trim();
  const bearerToken = parseBearerToken(req);
  return cookieToken || headerToken || bearerToken;
}

async function getAuthState(req) {
  const enabled = await hasUsers();
  if (!enabled) return { enabled: false, authenticated: true, token: "" };
  const token = await resolveAuthToken(req);
  if (!token) return { enabled: true, authenticated: false, token: "" };
  const session = await getAuthSession(token);
  return {
    enabled: true,
    authenticated: Boolean(session),
    token,
    user: session
      ? {
          username: String(session.username || ""),
          role: String(session.role || "user"),
        }
      : null,
  };
}

async function requireApiAuth(req, res) {
  const state = await getAuthState(req);
  if (!state.enabled || state.authenticated) return true;
  sendJson(res, 401, { ok: false, error: "unauthorized", authRequired: true });
  return false;
}

async function requireAdmin(req, res) {
  const state = await getAuthState(req);
  if (!state.enabled || !state.authenticated) {
    sendJson(res, 401, { ok: false, error: "unauthorized", authRequired: true });
    return null;
  }
  if (!state.user || state.user.role !== "admin") {
    sendJson(res, 403, { ok: false, error: "forbidden", adminRequired: true });
    return null;
  }
  return state;
}

async function readRawBody(req, maxBytes = 128 * 1024) {
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
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function readJsonBody(req, maxBytes = 128 * 1024) {
  const raw = (await readRawBody(req, maxBytes)).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON body");
  }
}

function shortLinkPublicUrls(req, id, params) {
  const origin = resolvePublicOrigin(req);
  const endpoint = params.endpoint === "sub" ? "sub" : "last";
  return {
    id,
    shortUrl: `${origin}/l/${id}`,
    editUrl: `${origin}/?sid=${id}`,
    resolvedUrl: `${origin}/${endpoint}?${buildQueryFromParams(params).toString()}`,
  };
}

function resolvePublicOrigin(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers.host || "").split(",")[0].trim() || "localhost";
  const proto = forwardedProto === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function cacheKey(subUrl, output, profileKey = "") {
  return sha1(`${subUrl}|${output}|${profileKey}`);
}

function cachePathForKey(key) {
  return `${CACHE_DIR}/${key}.yaml`;
}

function cacheMetaPathForKey(key) {
  return `${CACHE_DIR}/${key}.json`;
}

function decodeBase64IfNeeded(text) {
  const value = String(text || "").trim();
  if (!value || value.includes("://")) return String(text || "");
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value) || value.length < 120) return String(text || "");
  try {
    const decoded = Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8");
    return decoded && decoded.trim() ? decoded : String(text || "");
  } catch {
    return String(text || "");
  }
}

function detectSourceFormat(rawText, contentType = "") {
  const text = String(rawText || "").trim();
  if (!text) return "empty";
  const ct = String(contentType || "").toLowerCase();
  if (text.startsWith("<!doctype html") || text.startsWith("<html") || ct.includes("text/html")) return "html";
  if (ct.includes("application/json")) return "json";
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      // continue
    }
  }
  if (/^\s*proxies\s*:\s*$/m.test(text)) return "yml";
  if (/^(vmess|vless|ss|ssr|trojan):\/\//m.test(text)) return "raw";
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(text) && text.length > 120) {
    const decoded = decodeBase64IfNeeded(text);
    if (decoded !== text && /^(vmess|vless|ss|ssr|trojan):\/\//m.test(decoded)) return "raw(base64)";
  }
  return "unknown";
}

function decodeUriTitle(uri) {
  const item = String(uri || "").trim();
  if (!/^(vmess|vless|ss|ssr|trojan):\/\//.test(item)) return "";
  let title = "";
  try {
    const hashIndex = item.indexOf("#");
    if (hashIndex >= 0) {
      title = decodeURIComponent(item.slice(hashIndex + 1));
    }
  } catch {
    title = "";
  }
  return title || item.slice(0, 80);
}

function parseYamlProxyNames(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  const seen = new Set();
  let inProxies = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!inProxies) {
      if (/^proxies\s*:\s*$/i.test(trimmed)) inProxies = true;
      continue;
    }

    const newTopLevel = rawLine.match(/^([A-Za-z0-9_.-]+)\s*:/);
    if (newTopLevel && !rawLine.startsWith(" ") && !rawLine.startsWith("-")) break;

    const match = rawLine.match(/^\s*-\s*name\s*:\s*(.+)\s*$/);
    if (!match) continue;
    let name = String(match[1] || "").trim();
    if ((name.startsWith("\"") && name.endsWith("\"")) || (name.startsWith("'") && name.endsWith("'"))) {
      name = name.slice(1, -1);
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  return out;
}

function parseJsonServerEntries(text) {
  const out = [];
  const seen = new Set();
  const pushEntry = (name, uri = "") => {
    const safeName = String(name || "").trim();
    const safeUri = String(uri || "").trim();
    if (!safeName) return;
    const key = `${safeName}|${safeUri}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: safeName, uri: safeUri });
  };

  function visit(node, parentName = "") {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parentName);
      return;
    }
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && /^(vmess|vless|ss|ssr|trojan):\/\//.test(node.trim())) {
        pushEntry(decodeUriTitle(node), node);
      }
      return;
    }

    if (typeof node.uri === "string" && /^(vmess|vless|ss|ssr|trojan):\/\//.test(node.uri.trim())) {
      pushEntry(node.name || decodeUriTitle(node.uri), node.uri);
    }
    if (typeof node.url === "string" && /^(vmess|vless|ss|ssr|trojan):\/\//.test(node.url.trim())) {
      pushEntry(node.name || decodeUriTitle(node.url), node.url);
    }
    if (typeof node.name === "string" && !Array.isArray(node.proxies) && !Array.isArray(node.outbounds)) {
      pushEntry(node.name, "");
    }

    if (Array.isArray(node.proxies)) {
      for (const proxy of node.proxies) {
        if (proxy && typeof proxy === "object" && typeof proxy.name === "string") {
          pushEntry(proxy.name, proxy.uri || proxy.url || "");
        }
      }
    }

    if (Array.isArray(node.outbounds)) {
      const baseName = String(node.remarks || parentName || "").trim();
      for (const outbound of node.outbounds) {
        if (!outbound || typeof outbound !== "object") continue;
        const protocol = String(outbound.protocol || outbound.type || "").trim().toLowerCase();
        if (!["vless", "vmess", "ss", "ssr", "trojan"].includes(protocol)) continue;
        const tag = String(outbound.tag || outbound.name || protocol).trim();
        const name = [baseName, tag].filter(Boolean).join(" ").trim() || tag || protocol;
        pushEntry(name, "");
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value, String(node.remarks || parentName || "").trim());
    }
  }

  try {
    visit(JSON.parse(String(text || "")));
  } catch {
    return [];
  }

  return out;
}

function parseServerEntriesFromText(rawText) {
  const text = String(rawText || "");
  if (!text.trim()) return [];
  const out = [];
  const seen = new Set();
  const pushEntry = (name, uri = "") => {
    const safeName = String(name || "").trim();
    const safeUri = String(uri || "").trim();
    if (!safeName) return;
    const key = `${safeName}|${safeUri}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: safeName, uri: safeUri });
  };

  const format = detectSourceFormat(text);
  if (format === "yml") {
    for (const name of parseYamlProxyNames(text)) {
      pushEntry(name, "");
    }
    return out;
  }
  if (format === "json") {
    return parseJsonServerEntries(text);
  }

  const decoded = decodeBase64IfNeeded(text);
  for (const line of decoded.split(/\r?\n/)) {
    const uri = line.trim();
    if (!/^(vmess|vless|ss|ssr|trojan):\/\//.test(uri)) continue;
    pushEntry(decodeUriTitle(uri), uri);
  }
  return out;
}

function parseServersFromText(rawText) {
  return parseServerEntriesFromText(rawText).map((entry) => entry.name);
}

function normalizeOutputFormatToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return "";
  if (token.startsWith("raw")) return "raw";
  if (token.startsWith("json")) return "json";
  if (token === "yaml" || token.startsWith("yml")) return "yml";
  return "";
}

function sanitizeHeaderMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key || "").trim().toLowerCase();
    if (!k) continue;
    out[k] = String(value ?? "");
  }
  return out;
}

function decodeMaybeBase64Header(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("base64:")) return raw;
  try {
    return Buffer.from(raw.slice(7), "base64").toString("utf8").trim();
  } catch {
    return raw;
  }
}

function parseContentDispositionFilename(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const utf8 = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8 && utf8[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      return utf8[1].trim();
    }
  }
  const simple = raw.match(/filename\s*=\s*\"?([^\";]+)\"?/i);
  return simple?.[1] ? String(simple[1]).trim() : "";
}

function parseSubscriptionUserinfo(value) {
  const out = { upload: 0, download: 0, total: 0, expire: 0 };
  const raw = String(value || "");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const [k, v] = part.split("=").map((x) => String(x || "").trim().toLowerCase());
    if (!k) continue;
    const n = Number(v || "0");
    if (!Number.isFinite(n)) continue;
    if (k === "upload") out.upload = Math.max(0, n);
    if (k === "download") out.download = Math.max(0, n);
    if (k === "total") out.total = Math.max(0, n);
    if (k === "expire") out.expire = Math.max(0, n);
  }
  return out;
}

function firstHeaderString(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0] || "").trim() : "";
  }
  return String(value || "").trim();
}

function detectClientIp(req) {
  const xff = firstHeaderString(req.headers["x-forwarded-for"]);
  if (xff) return xff.split(",")[0].trim();
  const xri = firstHeaderString(req.headers["x-real-ip"]);
  if (xri) return xri;
  return String(req.socket?.remoteAddress || "").trim();
}

function resolveRawRequestHwid(reqUrl, reqHeaders, shortParams) {
  const fromQuery = String(reqUrl.searchParams.get("hwid") || "").trim();
  const fromHeader = firstHeaderString(reqHeaders["x-hwid"]);
  const fromShort = String(shortParams?.hwid || "").trim();
  const value = fromQuery || fromHeader || fromShort;
  return value.slice(0, 256);
}

function resolveRawClientInfo(req, reqUrl, shortParams) {
  const headers = sanitizeHeaderMap(req.headers || {});
  const hwid = resolveRawRequestHwid(reqUrl, req.headers || {}, shortParams);
  return {
    hwid,
    info: {
      ip: detectClientIp(req),
      userAgent: firstHeaderString(req.headers["user-agent"]),
      deviceModel: firstHeaderString(req.headers["x-device-model"]) || firstHeaderString(req.headers["sec-ch-ua-model"]),
      deviceOs: firstHeaderString(req.headers["x-device-os"]) || firstHeaderString(req.headers["sec-ch-ua-platform"]),
      app: String(reqUrl.searchParams.get("app") || shortParams?.app || headers["x-app"] || "").trim(),
      device: String(reqUrl.searchParams.get("device") || shortParams?.device || headers["x-device"] || "").trim(),
      acceptLanguage: firstHeaderString(req.headers["accept-language"]),
    },
  };
}

function humanBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size >= 100 ? size.toFixed(0) : size.toFixed(2)} ${units[idx]}`;
}

async function handleSubscriptionTest(req, res) {
  try {
    const body = await readJsonBody(req, 1024 * 1024);
    const params = {};
    const source = body && typeof body.params === "object" && !Array.isArray(body.params) ? body.params : body;
    for (const key of [...PARAM_KEYS, "endpoint"]) {
      if (source[key] === undefined || source[key] === null) continue;
      params[key] = String(source[key]).trim();
    }
    if (!params.output) params.output = "yml";
    if (!params.endpoint) params.endpoint = "last";

    const requestUrl = new URL("http://localhost/sub");
    for (const [k, v] of Object.entries(params)) {
      if (v) requestUrl.searchParams.set(k, v);
    }
    const reqHeaders = sanitizeHeaderMap(body?.headers || body?.forwardHeaders || {});
    const config = resolveRequestConfig(requestUrl, reqHeaders);
    if (!config.ok) {
      sendJson(res, config.status || 400, { ok: false, error: config.error || "invalid request" });
      return;
    }

    const { subUrl, output, profileNames, forwardHeaders, app, device } = config;
    if (!subUrl) {
      sendJson(res, 400, { ok: false, error: "sub_url is required" });
      return;
    }

    const fetched = await fetchWithNode(subUrl, forwardHeaders);
    const produced = await produceOutput(fetched.body, output, { app });

    const key = cacheKey(subUrl, output, profileNames.join(","));
    const cachePath = cachePathForKey(key);
    const cacheMetaPath = cacheMetaPathForKey(key);
    const cacheExists = fs.existsSync(cachePath);
    let cacheBytes = 0;
    let cacheBody = "";
    let cacheMeta = null;
    if (cacheExists) {
      try {
        const raw = fs.readFileSync(cachePath);
        cacheBytes = raw.length;
        cacheBody = raw.toString("utf8");
      } catch {
        cacheBytes = 0;
        cacheBody = "";
      }
    }
    if (fs.existsSync(cacheMetaPath)) {
      try {
        cacheMeta = JSON.parse(fs.readFileSync(cacheMetaPath, "utf8"));
      } catch {
        cacheMeta = null;
      }
    }

    let cacheValidation = { ok: false, error: "cache not found" };
    if (cacheExists && cacheBody) {
      const check = await produceOutput(cacheBody, output, { app });
      if (check.ok) {
        cacheValidation = {
          ok: true,
          contentType: check.contentType,
          conversion: check.conversion,
          detectedFormat: detectSourceFormat(cacheBody, check.contentType),
          servers: parseServersFromText(check.body).slice(0, 200),
        };
      } else {
        cacheValidation = { ok: false, error: check.error || "cache conversion failed" };
      }
    }

    const sourceFormat = detectSourceFormat(
      fetched.body,
      fetched.responseHeaders?.["content-type"] || fetched.responseHeaders?.["Content-Type"] || "",
    );
    const upstreamServers = parseServersFromText(fetched.body).slice(0, 200);
    const response = {
      ok: true,
      request: {
        endpoint: params.endpoint === "sub" ? "sub" : "last",
        subUrl,
        output,
        app,
        device,
        profiles: profileNames,
      },
      headers: {
        custom: reqHeaders,
        forwarded: forwardHeaders,
        upstream: fetched.responseHeaders || {},
      },
      upstream: {
        status: fetched.responseStatus,
        url: fetched.responseUrl,
        bodyBytes: Buffer.byteLength(String(fetched.body || ""), "utf8"),
        sourceFormat,
        servers: upstreamServers,
        body: String(fetched.body || ""),
      },
      conversion: produced.ok
        ? {
            ok: true,
            contentType: produced.contentType,
            conversion: produced.conversion,
            outputFormat: detectSourceFormat(produced.body, produced.contentType),
            servers: parseServersFromText(produced.body).slice(0, 200),
            body: String(produced.body || ""),
          }
        : {
            ok: false,
            error: produced.error || "conversion failed",
            body: "",
          },
      cache: {
        key,
        exists: cacheExists,
        path: cachePath,
        metaPath: cacheMetaPath,
        bytes: cacheBytes,
        meta: cacheMeta,
        bodySha1: cacheBody ? sha1(cacheBody) : "",
        validation: cacheValidation,
      },
    };
    sendJson(res, 200, response);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e?.message || "subscription test failed" });
  }
}

async function handleCreateShortLink(req, res) {
  try {
    const body = await readJsonBody(req);
    const picked = {};
    for (const key of PARAM_KEYS) {
      if (body[key] !== undefined) picked[key] = body[key];
    }
    const created = await createShortLink(picked);
    if (!created.ok) {
      sendJson(res, created.status || 400, created);
      return;
    }
    sendJson(res, 201, {
      ok: true,
      link: created.link,
      urls: shortLinkPublicUrls(req, created.link.id, created.link.params),
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "invalid request" });
  }
}

async function handleUpdateShortLink(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const picked = {};
    for (const key of PARAM_KEYS) {
      if (body[key] !== undefined) picked[key] = body[key];
    }
    const updated = await updateShortLink(id, sanitizeParams(picked));
    if (!updated.ok) {
      sendJson(res, updated.status || 400, updated);
      return;
    }
    sendJson(res, 200, {
      ok: true,
      link: updated.link,
      urls: shortLinkPublicUrls(req, updated.link.id, updated.link.params),
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "invalid request" });
  }
}

async function handleGetShortLink(req, res, id) {
  const found = await getShortLink(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  sendJson(res, 200, {
    ok: true,
    link: found.link,
    urls: shortLinkPublicUrls(req, found.link.id, found.link.params),
  });
}

async function handleGetShortLinkUsers(req, res, id) {
  const found = await getShortLink(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  try {
    const data = await listShortLinkUsers(found.link.id);
    sendJson(res, 200, { ok: true, users: data });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e?.message || "failed to load short link users" });
  }
}

async function handleUpdateShortLinkUsersPolicy(req, res, id) {
  const found = await getShortLink(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  try {
    const body = await readJsonBody(req);
    const updated = await updateShortLinkUserPolicy(found.link.id, {
      maxUsers: body?.maxUsers,
      blockedMessage: body?.blockedMessage,
      limitMessage: body?.limitMessage,
    });
    sendJson(res, 200, { ok: true, policy: updated });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "failed to update policy" });
  }
}

async function handleUpdateShortLinkUser(req, res, id, hwidToken) {
  const found = await getShortLink(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  let hwid = "";
  try {
    hwid = decodeURIComponent(String(hwidToken || ""));
  } catch {
    hwid = String(hwidToken || "");
  }
  try {
    const body = await readJsonBody(req);
    const updated = await setShortLinkUserBlocked(
      found.link.id,
      hwid,
      Boolean(body?.blocked),
      String(body?.blockReason || ""),
    );
    if (!updated) {
      sendJson(res, 404, { ok: false, error: "user not found" });
      return;
    }
    sendJson(res, 200, { ok: true, user: updated });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "failed to update user" });
  }
}

async function handleDeleteShortLinkUser(req, res, id, hwidToken) {
  const found = await getShortLink(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  let hwid = "";
  try {
    hwid = decodeURIComponent(String(hwidToken || ""));
  } catch {
    hwid = String(hwidToken || "");
  }
  try {
    await deleteShortLinkUser(found.link.id, hwid);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "failed to delete user" });
  }
}

async function handlePublicShortLink(req, res, id) {
  const found = await getShortLink(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  sendJson(res, 200, {
    ok: true,
    link: found.link,
    urls: shortLinkPublicUrls(req, found.link.id, found.link.params),
  });
}

async function handlePublicShortLinkMeta(req, res, id) {
  const found = await getShortLink(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  try {
    const params = found.link.params || {};
    const requestUrl = new URL("http://localhost/sub");
    for (const [k, v] of Object.entries(params)) {
      if (!v) continue;
      requestUrl.searchParams.set(k, String(v));
    }
    const config = resolveRequestConfig(requestUrl, {});
    if (!config.ok) {
      sendJson(res, config.status || 400, { ok: false, error: config.error || "invalid request config" });
      return;
    }

    const fetched = await fetchWithNode(config.subUrl, config.forwardHeaders);
    const upstreamHeaders = fetched.responseHeaders || {};
    const userinfo = parseSubscriptionUserinfo(
      upstreamHeaders["subscription-userinfo"] || upstreamHeaders["Subscription-Userinfo"] || "",
    );
    const expireAt = userinfo.expire > 0 ? userinfo.expire * 1000 : 0;
    const now = Date.now();
    const daysLeft = expireAt > 0 ? Math.ceil((expireAt - now) / (1000 * 60 * 60 * 24)) : 0;
    const active = expireAt <= 0 || expireAt > now;
    const providerName = decodeMaybeBase64Header(
      upstreamHeaders["profile-title"] ||
      upstreamHeaders["Profile-Title"] ||
      "",
    ) || String(
      upstreamHeaders.provider ||
      upstreamHeaders.Provider ||
      "",
    ).trim() || "Неизвестный провайдер";
    const userName = parseContentDispositionFilename(
      upstreamHeaders["content-disposition"] || upstreamHeaders["Content-Disposition"] || "",
    ) || found.link.id;
    const sourceFormat = detectSourceFormat(
      fetched.body,
      upstreamHeaders["content-type"] || upstreamHeaders["Content-Type"] || "",
    );
    const servers = parseServersFromText(fetched.body);
    let serverEntries = parseServerEntriesFromText(fetched.body);
    if (serverEntries.length === 0 || serverEntries.every((row) => !row.uri)) {
      const convertedRaw = await produceOutput(fetched.body, "raw");
      if (convertedRaw.ok) {
        const convertedEntries = parseServerEntriesFromText(convertedRaw.body);
        if (convertedEntries.length > 0) {
          serverEntries = convertedEntries;
        }
      }
    }
    const used = Math.max(0, userinfo.upload + userinfo.download);
    const totalText = userinfo.total > 0 ? humanBytes(userinfo.total) : "∞";
    const trafficText = `${humanBytes(used)} / ${totalText}`;
    const forwardHeaders = sanitizeHeaderMap(config.forwardHeaders || {});
    const deviceModel =
      String(
        forwardHeaders["x-device-model"] ||
        forwardHeaders["sec-ch-ua-model"] ||
        config.device ||
        "",
      ).trim();
    const userAgent = String(forwardHeaders["user-agent"] || "").trim();

    sendJson(res, 200, {
      ok: true,
      meta: {
        providerName,
        userName,
        active,
        statusText: active ? "Активна" : "Истекла",
        expiresAt: expireAt || null,
        daysLeft: expireAt > 0 ? daysLeft : null,
        trafficText,
        usedBytes: used,
        totalBytes: userinfo.total,
        provider: String(upstreamHeaders.provider || upstreamHeaders.Provider || ""),
        sourceFormat,
        sourceFormatToken: normalizeOutputFormatToken(sourceFormat),
        serversCount: servers.length,
        serverEntries: serverEntries.slice(0, 300),
        app: config.app || "",
        device: config.device || "",
        deviceModel,
        userAgent,
        profiles: config.profileNames || [],
      },
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e?.message || "meta fetch failed" });
  }
}

function wantsHtmlSharePage(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  return accept.includes("text/html");
}

async function handleShortLinkResolve(req, res, id) {
  const found = await getShortLink(id);
  if (!found.ok) {
    res.writeHead(found.status || 404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(found.error || "short link not found");
    return;
  }

  try {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const client = resolveRawClientInfo(req, reqUrl, found.link.params || {});
    const visit = await recordShortLinkUserVisit(found.link.id, client.hwid, client.info);
    if (!visit.ok && (visit.code === "blocked" || visit.code === "limit")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(String(visit.message || "Доступ к подписке ограничен"));
      return;
    }
  } catch (e) {
    console.error("[WARN] short-link user tracking failed:", e?.message || e);
  }

  await incrementShortLinkHits(found.link.id);

  if (wantsHtmlSharePage(req)) {
    if (!serveFrontendIndex(res)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHomePage());
    }
    return;
  }

  const endpoint = found.link.params.endpoint === "sub" ? "/sub" : "/last";
  const params = { ...(found.link.params || {}) };
  try {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const type = String(reqUrl.searchParams.get("type") || "").trim().toLowerCase();
    if (type === "raw" || type === "yml" || type === "yaml" || type === "clash") {
      params.output = type === "raw" ? "raw" : "yml";
    }
  } catch {
    // ignore malformed query and keep original params
  }
  const qs = buildQueryFromParams(params).toString();
  const originalUrl = req.url;
  req.url = `${endpoint}?${qs}`;
  const handler = endpoint === "/sub" ? handleSubscription : handleLast;
  void handler(req, res).finally(() => {
    req.url = originalUrl;
  });
}

function mockSourcePublicUrls(req, id) {
  const origin = resolvePublicOrigin(req);
  return {
    id,
    sourceUrl: `${origin}/mock/${id}`,
    logsUrl: `${origin}/api/mock-sources/${id}/logs`,
  };
}

async function handleCreateMockSource(req, res) {
  try {
    const body = await readJsonBody(req);
    const created = createMockSource(body);
    if (!created.ok) {
      sendJson(res, created.status || 400, created);
      return;
    }
    sendJson(res, 201, {
      ok: true,
      source: created.source,
      urls: mockSourcePublicUrls(req, created.source.id),
      presets: listPresets(),
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "invalid request" });
  }
}

function handleGetMockSource(req, res, id) {
  const found = getMockSource(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  sendJson(res, 200, {
    ok: true,
    source: {
      id: found.source.id,
      createdAt: found.source.createdAt,
      updatedAt: found.source.updatedAt,
      config: found.source.config,
      logsCount: Array.isArray(found.source.logs) ? found.source.logs.length : 0,
    },
    urls: mockSourcePublicUrls(req, found.source.id),
    presets: listPresets(),
  });
}

async function handleUpdateMockSource(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const updated = updateMockSource(id, body);
    if (!updated.ok) {
      sendJson(res, updated.status || 400, updated);
      return;
    }
    sendJson(res, 200, {
      ok: true,
      source: updated.source,
      urls: mockSourcePublicUrls(req, updated.source.id),
      presets: listPresets(),
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "invalid request" });
  }
}

function handleGetMockLogs(req, res, id) {
  const found = getMockSource(id);
  if (!found.ok) {
    sendJson(res, found.status || 404, found);
    return;
  }
  sendJson(res, 200, {
    ok: true,
    id: found.source.id,
    logs: Array.isArray(found.source.logs) ? found.source.logs : [],
  });
}

function handleClearMockLogs(req, res, id) {
  const cleared = clearMockLogs(id);
  if (!cleared.ok) {
    sendJson(res, cleared.status || 404, cleared);
    return;
  }
  sendJson(res, 200, { ok: true, id: cleared.source.id, logs: [] });
}

async function handleMockSourceRequest(req, res, id, reqUrl) {
  const found = getMockSource(id);
  if (!found.ok) {
    res.writeHead(found.status || 404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(found.error || "mock source not found");
    return;
  }

  const source = found.source;
  const rawBody = await readRawBody(req, 1024 * 1024).catch(() => Buffer.from(""));
  const bodyText = rawBody.toString("utf8");
  const query = {};
  for (const [k, v] of reqUrl.searchParams.entries()) {
    if (query[k] === undefined) query[k] = v;
    else if (Array.isArray(query[k])) query[k].push(v);
    else query[k] = [query[k], v];
  }

  appendMockLog(id, {
    method: req.method || "GET",
    path: reqUrl.pathname,
    query,
    headers: req.headers,
    body: bodyText,
    bodyBase64: rawBody.toString("base64"),
    bodyBytes: rawBody.length,
  });

  const cfg = source.config || {};
  if (cfg.delayMs && cfg.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, cfg.delayMs));
  }

  const headers = {
    "Content-Type": cfg.contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...(cfg.headers && typeof cfg.headers === "object" ? cfg.headers : {}),
  };
  const status = Number(cfg.status) || 200;
  res.writeHead(status, headers);
  res.end(String(cfg.body ?? ""));
}

function handleProfileEditorList(res) {
  sendJson(res, 200, { ok: true, catalog: listEditorCatalog() });
}

function handleProfileEditorRead(reqUrl, res) {
  const kind = reqUrl.searchParams.get("kind") || "";
  const name = reqUrl.searchParams.get("name") || "";
  const out = readProfileForEdit(kind, name);
  if (!out.ok) {
    sendJson(res, out.status || 400, out);
    return;
  }
  sendJson(res, 200, out);
}

async function handleProfileEditorSave(req, res) {
  try {
    const body = await readJsonBody(req, 2 * 1024 * 1024);
    const out = saveProfileForEdit(body.kind, body.name, body.content);
    if (!out.ok) {
      sendJson(res, out.status || 400, out);
      return;
    }
    sendJson(res, 200, { ...out, catalog: listEditorCatalog() });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "invalid request" });
  }
}

function handleProfileEditorDelete(reqUrl, res) {
  const kind = reqUrl.searchParams.get("kind") || "";
  const name = reqUrl.searchParams.get("name") || "";
  const out = deleteProfileForEdit(kind, name);
  if (!out.ok) {
    sendJson(res, out.status || 400, out);
    return;
  }
  sendJson(res, 200, { ...out, catalog: listEditorCatalog() });
}

async function handleAuthMe(req, res) {
  const state = await getAuthState(req);
  sendJson(res, 200, {
    ok: true,
    config: {
      publicBaseUrl: resolvePublicOrigin(req),
    },
    auth: {
      enabled: state.enabled,
      authenticated: state.authenticated,
      user: state.user || null,
    },
  });
}

async function handleAuthLogin(req, res) {
  const enabled = await hasUsers();
  if (!enabled) {
    sendJson(res, 200, { ok: true, auth: { enabled: false, authenticated: true, user: null } });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!username || !password) {
      sendJson(res, 401, { ok: false, error: "invalid credentials", authRequired: true });
      return;
    }
    const user = await verifyUserCredentials(username, password);
    if (!user) {
      sendJson(res, 401, { ok: false, error: "invalid credentials", authRequired: true });
      return;
    }
    const session = await createAuthSessionForUser(user.username, AUTH_SESSION_TTL_SEC);
    const maxAge = Math.max(60, Number(AUTH_SESSION_TTL_SEC || 0));
    sendJson(
      res,
      200,
      {
        ok: true,
        auth: {
          enabled: true,
          authenticated: true,
          user: {
            username: user.username,
            role: user.role,
          },
        },
      },
      { "Set-Cookie": `sub_auth=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` },
    );
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "invalid request" });
  }
}

async function handleAuthLogout(req, res) {
  const token = await resolveAuthToken(req);
  if (token) await deleteAuthSession(token);
  const enabled = await hasUsers();
  sendJson(
    res,
    200,
    { ok: true, auth: { enabled, authenticated: false, user: null } },
    { "Set-Cookie": "sub_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" },
  );
}

async function handleAdminUsersList(req, res) {
  const state = await requireAdmin(req, res);
  if (!state) return;
  const users = await listAuthUsers();
  sendJson(res, 200, { ok: true, users });
}

async function handleAdminUsersCreate(req, res) {
  const state = await requireAdmin(req, res);
  if (!state) return;
  try {
    const body = await readJsonBody(req);
    const user = await createAuthUser({
      username: body.username,
      password: body.password,
      role: body.role,
    });
    sendJson(res, 201, { ok: true, user });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "unable to create user" });
  }
}

async function handleAdminUsersUpdate(req, res, username) {
  const state = await requireAdmin(req, res);
  if (!state) return;
  try {
    const body = await readJsonBody(req);
    const login = String(username || "").trim().toLowerCase();
    if (state.user?.username === login && body?.role !== undefined) {
      sendJson(res, 400, { ok: false, error: "cannot change current admin role" });
      return;
    }
    const user = await updateAuthUser(username, {
      role: body.role,
      password: body.password,
    });
    if (!user) {
      sendJson(res, 404, { ok: false, error: "user not found" });
      return;
    }
    sendJson(res, 200, { ok: true, user });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "unable to update user" });
  }
}

async function handleAdminUsersDelete(req, res, username) {
  const state = await requireAdmin(req, res);
  if (!state) return;
  const login = String(username || "").trim().toLowerCase();
  if (state.user?.username === login) {
    sendJson(res, 400, { ok: false, error: "cannot delete current admin user" });
    return;
  }
  const ok = await deleteAuthUser(login);
  if (!ok) {
    sendJson(res, 404, { ok: false, error: "user not found" });
    return;
  }
  sendJson(res, 200, { ok: true });
}

async function resolveFavoritesAccountKey(req) {
  const state = await getAuthState(req);
  if (state.enabled) return String(state.user?.username || "").trim();
  return "public";
}

async function handleFavoritesGet(req, res) {
  const key = await resolveFavoritesAccountKey(req);
  if (!key) {
    sendJson(res, 401, { ok: false, error: "unauthorized", authRequired: true });
    return;
  }
  const favorites = await getFavoritesRow(key);
  sendJson(res, 200, { ok: true, favorites });
}

async function handleFavoritesPut(req, res) {
  const key = await resolveFavoritesAccountKey(req);
  if (!key) {
    sendJson(res, 401, { ok: false, error: "unauthorized", authRequired: true });
    return;
  }
  try {
    const body = await readJsonBody(req, 2 * 1024 * 1024);
    const favorites = Array.isArray(body?.favorites) ? body.favorites : [];
    const saved = await setFavoritesRow(key, favorites);
    sendJson(res, 200, { ok: true, favorites: saved });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || "invalid request" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const routePath = url.pathname;
  const shortResolveMatch = routePath.match(/^\/l\/([A-Za-z0-9_-]+)$/);
  const publicShortApiMatch = routePath.match(/^\/api\/public-short-links\/([A-Za-z0-9_-]+)$/);
  const publicShortMetaApiMatch = routePath.match(/^\/api\/public-short-links\/([A-Za-z0-9_-]+)\/meta$/);
  const shortApiMatch = routePath.match(/^\/api\/short-links\/([A-Za-z0-9_-]+)$/);
  const shortUsersApiMatch = routePath.match(/^\/api\/short-links\/([A-Za-z0-9_-]+)\/users$/);
  const shortUserApiMatch = routePath.match(/^\/api\/short-links\/([A-Za-z0-9_-]+)\/users\/([^/]+)$/);
  const mockApiMatch = routePath.match(/^\/api\/mock-sources\/([A-Za-z0-9_-]+)$/);
  const mockLogsMatch = routePath.match(/^\/api\/mock-sources\/([A-Za-z0-9_-]+)\/logs$/);
  const adminUserApiMatch = routePath.match(/^\/api\/admin\/users\/([a-zA-Z0-9._-]+)$/);
  const mockResolveMatch = routePath.match(/^\/mock\/([A-Za-z0-9_-]+)$/);

  if (req.method === "GET" && routePath === "/api/auth/me") {
    await handleAuthMe(req, res);
    return;
  }
  if (req.method === "POST" && routePath === "/api/auth/login") {
    await handleAuthLogin(req, res);
    return;
  }
  if (req.method === "POST" && routePath === "/api/auth/logout") {
    await handleAuthLogout(req, res);
    return;
  }
  if (req.method === "GET" && routePath === "/api/favorites") {
    if (!(await requireApiAuth(req, res))) return;
    await handleFavoritesGet(req, res);
    return;
  }
  if (req.method === "PUT" && routePath === "/api/favorites") {
    if (!(await requireApiAuth(req, res))) return;
    await handleFavoritesPut(req, res);
    return;
  }
  if (req.method === "GET" && routePath === "/api/admin/users") {
    await handleAdminUsersList(req, res);
    return;
  }
  if (req.method === "POST" && routePath === "/api/admin/users") {
    await handleAdminUsersCreate(req, res);
    return;
  }
  if (req.method === "PUT" && adminUserApiMatch) {
    await handleAdminUsersUpdate(req, res, adminUserApiMatch[1]);
    return;
  }
  if (req.method === "DELETE" && adminUserApiMatch) {
    await handleAdminUsersDelete(req, res, adminUserApiMatch[1]);
    return;
  }

  if (req.method === "GET" && routePath === "/") {
    if (!serveFrontendIndex(res)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHomePage());
    }
    return;
  }
  if (req.method === "GET" && routePath === "/admin") {
    const state = await getAuthState(req);
    if (state.enabled && (!state.authenticated || state.user?.role !== "admin")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("forbidden");
      return;
    }
    if (!serveFrontendIndex(res)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHomePage());
    }
    return;
  }
  if (req.method === "GET" && routePath === "/sub") {
    void handleSubscription(req, res);
    return;
  }
  if (req.method === "GET" && routePath === "/last") {
    void handleLast(req, res);
    return;
  }
  if (req.method === "GET" && routePath === "/subscription.yaml") {
    void handleSubscription(req, res);
    return;
  }
  if (routePath === "/debug/echo") {
    void handleEcho(req, res);
    return;
  }
  if (req.method === "GET" && routePath === "/api/profile-editor/list") {
    if (!(await requireApiAuth(req, res))) return;
    handleProfileEditorList(res);
    return;
  }
  if (req.method === "GET" && publicShortMetaApiMatch) {
    await handlePublicShortLinkMeta(req, res, publicShortMetaApiMatch[1]);
    return;
  }
  if (req.method === "GET" && publicShortApiMatch) {
    await handlePublicShortLink(req, res, publicShortApiMatch[1]);
    return;
  }
  if (req.method === "GET" && routePath === "/api/ua-catalog") {
    if (!(await requireApiAuth(req, res))) return;
    const { options, defaultUa } = getUaCatalogOptions();
    sendJson(res, 200, { ok: true, options, defaultUa });
    return;
  }
  if (req.method === "GET" && routePath === "/api/apps") {
    const catalog = getAppsCatalog();
    sendJson(res, 200, {
      ok: true,
      apps: catalog.apps,
      shareLinks: catalog.shareLinks,
      items: catalog.items,
      recommendedByOs: catalog.recommendedByOs,
      orderByOs: catalog.orderByOs,
    });
    return;
  }
  if (req.method === "GET" && routePath === "/api/apps/guide") {
    const app = String(url.searchParams.get("app") || "");
    const os = String(url.searchParams.get("os") || "");
    const result = getAppGuide(app, os);
    if (!result.ok) {
      sendJson(res, result.status || 404, result);
      return;
    }
    sendJson(res, 200, { ok: true, guide: result.guide });
    return;
  }
  if (req.method === "GET" && routePath === "/api/profile-editor/file") {
    if (!(await requireApiAuth(req, res))) return;
    handleProfileEditorRead(url, res);
    return;
  }
  if (req.method === "PUT" && routePath === "/api/profile-editor/file") {
    if (!(await requireApiAuth(req, res))) return;
    void handleProfileEditorSave(req, res);
    return;
  }
  if (req.method === "DELETE" && routePath === "/api/profile-editor/file") {
    if (!(await requireApiAuth(req, res))) return;
    handleProfileEditorDelete(url, res);
    return;
  }
  if (req.method === "POST" && routePath === "/api/sub-test") {
    if (!(await requireApiAuth(req, res))) return;
    void handleSubscriptionTest(req, res);
    return;
  }
  if (req.method === "POST" && routePath === "/api/short-links") {
    if (!(await requireApiAuth(req, res))) return;
    void handleCreateShortLink(req, res);
    return;
  }
  if (req.method === "GET" && shortApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    await handleGetShortLink(req, res, shortApiMatch[1]);
    return;
  }
  if (req.method === "GET" && shortUsersApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    await handleGetShortLinkUsers(req, res, shortUsersApiMatch[1]);
    return;
  }
  if (req.method === "PATCH" && shortUsersApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    void handleUpdateShortLinkUsersPolicy(req, res, shortUsersApiMatch[1]);
    return;
  }
  if (req.method === "PATCH" && shortUserApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    void handleUpdateShortLinkUser(req, res, shortUserApiMatch[1], shortUserApiMatch[2]);
    return;
  }
  if (req.method === "DELETE" && shortUserApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    void handleDeleteShortLinkUser(req, res, shortUserApiMatch[1], shortUserApiMatch[2]);
    return;
  }
  if (req.method === "PUT" && shortApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    void handleUpdateShortLink(req, res, shortApiMatch[1]);
    return;
  }
  if (req.method === "GET" && shortResolveMatch) {
    await handleShortLinkResolve(req, res, shortResolveMatch[1]);
    return;
  }
  if (req.method === "POST" && routePath === "/api/mock-sources") {
    if (!(await requireApiAuth(req, res))) return;
    void handleCreateMockSource(req, res);
    return;
  }
  if (req.method === "GET" && mockApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    handleGetMockSource(req, res, mockApiMatch[1]);
    return;
  }
  if (req.method === "PUT" && mockApiMatch) {
    if (!(await requireApiAuth(req, res))) return;
    void handleUpdateMockSource(req, res, mockApiMatch[1]);
    return;
  }
  if (req.method === "GET" && mockLogsMatch) {
    if (!(await requireApiAuth(req, res))) return;
    handleGetMockLogs(req, res, mockLogsMatch[1]);
    return;
  }
  if (req.method === "POST" && mockLogsMatch) {
    if (!(await requireApiAuth(req, res))) return;
    handleClearMockLogs(req, res, mockLogsMatch[1]);
    return;
  }
  if (mockResolveMatch) {
    void handleMockSourceRequest(req, res, mockResolveMatch[1], url);
    return;
  }

  const staticEntry = STATIC_FILES.get(routePath);
  if (req.method === "GET" && staticEntry) {
    serveStaticFile(res, staticEntry);
    return;
  }

  if (req.method === "GET" && routePath.startsWith("/assets/")) {
    if (serveFrontendAsset(routePath, res)) return;
  }
  if (req.method === "GET" && /\.(css|js|map|svg|png|jpg|jpeg|webp|ico|woff2)$/i.test(routePath)) {
    if (serveFrontendAsset(routePath, res)) return;
  }

  if (req.method === "GET" && routePath === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && FRONTEND_DIST) {
    const accept = String(req.headers.accept || "");
    if (accept.includes("text/html")) {
      if (serveFrontendIndex(res)) return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

function startServer() {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[OK] listening on :${PORT}`);
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(path.join(SERVER_DIR, "server.js"));
if (isMain) {
  startServer();
}

export {
  normalizeOutput,
  renderHomePage,
  parseProfileYaml,
  readProfileFile,
  profileExists,
  pickUserAgentProfile,
  resolveRequestConfig,
  produceOutput,
  startServer,
};
