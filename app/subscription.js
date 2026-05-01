import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  SUB_URL_DEFAULT,
  CONVERTER_URL,
  SOURCE_URL,
  PROFILE_ROOT_DIRS,
  HEADER_POLICY_DEFAULT,
  OUTPUT_RAW,
  OUTPUT_RAW_BASE64,
  OUTPUT_JSON,
  OUTPUT_CLASH,
  OUTPUT_DEFAULT,
  OUT_RAW,
  OUT_YAML,
  OUT_STATUS,
  OUT_CONVERTED,
  SOURCE_PATH,
  CACHE_DIR,
  normalizeOutput,
} from "./config.js";
import { resolveLocalSourceFilePath } from "./local-sources.js";
import { getMergedSource } from "./local-sources.js";
import { parseBulkProxyText } from "./proxy-import.js";
import {
  buildSubscriptionFeedKey,
  getSubscriptionFeedByKey,
  upsertSubscriptionFeed,
  createSourceSnapshot,
  createNormalizedSnapshot,
  getLatestSourceSnapshotForFeed,
  getNormalizedSnapshotBySourceSnapshotId,
  getSubscriptionOverridesForFeed,
} from "./sqlite-store.js";
import {
  writeRawSourceSnapshotBody,
  writeNormalizedSnapshotFile,
  readSnapshotFile,
  pruneStoredSnapshots,
} from "./source-snapshots.js";

const UA_CATALOG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../resources/ua-catalog.json");
const execFile = promisify(execFileCb);
const HAPP_DECRYPT_BIN = path.resolve(
  process.env.HAPP_DECRYPT_BIN || path.join(path.dirname(fileURLToPath(import.meta.url)), "bin/happ-decrypt-linux-x64_x86"),
);
const LOCAL_SOURCE_ROOTS = [
  process.cwd(),
  "/data",
  "/resources",
].map((root) => path.resolve(root));

function isEncryptedHappLink(value) {
  return /^happ:\/\/crypt\d*\//i.test(String(value || "").trim());
}

function stripIndentedBlock(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s+/, ""))
    .join("\n")
    .trim();
}

function extractHappDecryptResult(stdout) {
  const text = String(stdout || "").replace(/\r/g, "").trim();
  if (!text) throw new Error("empty decrypt output");
  const resultMatch = text.match(/(?:^|\n)Result\s*\n([\s\S]+)$/m);
  if (resultMatch?.[1]) return stripIndentedBlock(resultMatch[1]);
  const errorMatch = text.match(/(?:^|\n)Error\s*\n([\s\S]+)$/m);
  if (errorMatch?.[1]) throw new Error(stripIndentedBlock(errorMatch[1]));
  if (/^https?:\/\//i.test(text)) return text;
  throw new Error("unable to parse decrypt output");
}

async function decryptHappLink(subUrl) {
  const raw = String(subUrl || "").trim();
  if (!isEncryptedHappLink(raw)) {
    return {
      ok: true,
      changed: false,
      originalUrl: raw,
      resolvedUrl: raw,
      output: raw,
    };
  }
  if (!fs.existsSync(HAPP_DECRYPT_BIN)) {
    throw new Error(`happ decrypt binary not found: ${HAPP_DECRYPT_BIN}`);
  }
  try {
    const { stdout, stderr } = await execFile(HAPP_DECRYPT_BIN, [raw], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const resolvedUrl = extractHappDecryptResult(stdout || stderr || "");
    return {
      ok: true,
      changed: resolvedUrl !== raw,
      originalUrl: raw,
      resolvedUrl,
      output: String(stdout || "").trim(),
    };
  } catch (error) {
    const stdout = String(error?.stdout || "");
    const stderr = String(error?.stderr || "");
    const detail = stdout || stderr;
    if (detail) {
      try {
        extractHappDecryptResult(detail);
      } catch (parseError) {
        throw new Error(parseError?.message || "happ decrypt failed");
      }
    }
    throw new Error(error?.message || "happ decrypt failed");
  }
}

function isHtml(s) {
  const t = s.trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function looksLikeClashProviderYaml(s) {
  return /^\s*proxies\s*:\s*$/m.test(s);
}

function looksLikeFullClashConfig(s) {
  const text = String(s || "");
  return /^(?:mixed-port|port|socks-port|redir-port|tproxy-port|allow-lan|mode|log-level|external-controller|secret|dns|proxy-groups|rules|rule-providers|proxy-providers)\s*:/m.test(
    text,
  );
}

function shouldWrapClashProviderForFlClash(s) {
  const text = String(s || "").trim();
  return looksLikeClashProviderYaml(text) && !looksLikeFullClashConfig(text);
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
  if ((!t.startsWith("{") || !t.endsWith("}")) && (!t.startsWith("[") || !t.endsWith("]"))) return rawText;
  try {
    const parsed = JSON.parse(t);
    const cryptoLink = parsed?.happ?.cryptoLink;
    if (typeof cryptoLink === "string" && cryptoLink.trim()) {
      return cryptoLink.trim();
    }
    const outboundLinks = extractRawUrisFromJsonConfig(parsed);
    if (outboundLinks) return outboundLinks;
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

function parseJsonText(rawText, fallback = null) {
  try {
    return JSON.parse(String(rawText || ""));
  } catch {
    return fallback;
  }
}

function normalizeModelNode(item, index, sourceFormat) {
  return {
    id: `node-${String(index + 1).padStart(4, "0")}`,
    name: String(item?.name || `node-${index + 1}`),
    enabled: true,
    type: String(item?.type || "").toLowerCase(),
    endpoint: {
      host: String(item?.server || ""),
      port: Number(item?.port || 0),
    },
    auth: {
      uuid: String(item?.uuid || ""),
      password: String(item?.password || ""),
      method: String(item?.transport?.method || ""),
      alterId: String(item?.transport?.aid || ""),
      flow: String(item?.flow || ""),
    },
    transport: {
      network: String(item?.network || ""),
      path: String(item?.path || ""),
      host: String(item?.host || ""),
      serviceName: String(item?.serviceName || ""),
      headerType: String(item?.transport?.headerType || ""),
      authority: String(item?.transport?.authority || ""),
      mode: String(item?.transport?.mode || ""),
      alpn: String(item?.transport?.alpn || ""),
      seed: String(item?.transport?.seed || ""),
      quicSecurity: String(item?.transport?.quicSecurity || ""),
      key: String(item?.transport?.key || ""),
    },
    security: {
      mode: String(item?.security || ""),
      sni: String(item?.sni || item?.servername || ""),
      fp: String(item?.clientFingerprint || item?.fp || ""),
      pbk: String(item?.publicKey || item?.pbk || ""),
      sid: String(item?.shortId || item?.sid || ""),
    },
    origin: {
      sourceFormat,
      uri: String(item?.uri || ""),
      servername: String(item?.servername || ""),
      rawType: String(item?.type || ""),
    },
  };
}

function buildNormalizedNodesFromRawText(rawText, sourceFormat) {
  return parseBulkProxyText(rawText).map((item, index) => normalizeModelNode(item, index, sourceFormat));
}

function buildNormalizedModelFromJson(rawText) {
  const parsed = parseJsonText(rawText, null);
  const configs = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : (parsed && typeof parsed === "object" ? [parsed] : []);
  const rawUris = extractRawUrisFromJsonConfig(configs);
  const nodes = rawUris ? buildNormalizedNodesFromRawText(rawUris, "json") : [];
  const topology = {
    balancers: configs.flatMap((config) => Array.isArray(config?.routing?.balancers) ? config.routing.balancers : []),
    observatory: configs
      .map((config) => config?.observatory)
      .filter((item) => item && typeof item === "object"),
    selectors: configs.flatMap((config) => Array.isArray(config?.observatory?.subjectSelector) ? [config.observatory.subjectSelector] : []),
  };
  const policy = {
    routingRules: configs.flatMap((config) => Array.isArray(config?.routing?.rules) ? config.routing.rules : []),
    dns: configs
      .map((config) => config?.dns)
      .filter((item) => item && typeof item === "object"),
    inbounds: configs.flatMap((config) => Array.isArray(config?.inbounds) ? config.inbounds : []),
    outbounds: configs.flatMap((config) => Array.isArray(config?.outbounds) ? config.outbounds : []),
  };
  return {
    model: {
      schemaVersion: 1,
      meta: {
        sourceFormat: "json",
        parserVersion: "normalized-v1",
      },
      nodes,
      topology,
      policy,
      extensions: {
        xray: {
          configCount: configs.length,
          remarks: configs.map((config) => String(config?.remarks || "")).filter(Boolean),
          configs,
        },
      },
    },
    warnings: [],
    lossFlags: [],
  };
}

function buildNormalizedModelFromYaml(rawText) {
  const rawUris = convertClashYamlToRawUris(rawText);
  const nodes = rawUris ? buildNormalizedNodesFromRawText(rawUris, "yml") : [];
  const proxyGroups = parseClashProxyGroups(rawText);
  const rules = parseClashRules(rawText);
  const dnsSection = extractTopLevelYamlSection(rawText, "dns");
  return {
    model: {
      schemaVersion: 1,
      meta: {
        sourceFormat: "yml",
        parserVersion: "normalized-v1",
        fullClashConfig: looksLikeFullClashConfig(rawText),
      },
      nodes,
      topology: {
        proxyGroups,
      },
      policy: {
        rules,
        dns: dnsSection ? { raw: dnsSection } : {},
      },
      extensions: {
        clash: {
          proxyCount: nodes.length,
          providerStyle: looksLikeClashProviderYaml(rawText),
          originalText: String(rawText || ""),
        },
      },
    },
    warnings: nodes.length > 0 ? [] : ["no-nodes-parsed-from-yaml"],
    lossFlags: [],
  };
}

function buildNormalizedModelFromRaw(rawText, sourceFormat) {
  const normalizedRaw = sourceFormat === "raw(base64)" ? decodeBase64IfNeeded(rawText) : rawText;
  const nodes = buildNormalizedNodesFromRawText(normalizedRaw, sourceFormat);
  return {
    model: {
      schemaVersion: 1,
      meta: {
        sourceFormat,
        parserVersion: "normalized-v1",
      },
      nodes,
      topology: {},
      policy: {},
      extensions: {
        raw: {
          lineCount: extractSubscriptionLines(normalizedRaw).length,
        },
      },
    },
    warnings: nodes.length > 0 ? [] : ["no-nodes-parsed-from-raw"],
    lossFlags: [],
  };
}

function buildNormalizedModelFromSource(rawText, contentType = "") {
  const sourceFormat = detectSourceFormat(rawText, contentType);
  if (sourceFormat === "json") return { sourceFormat, ...buildNormalizedModelFromJson(rawText) };
  if (sourceFormat === "yml") return { sourceFormat, ...buildNormalizedModelFromYaml(rawText) };
  if (sourceFormat === "raw" || sourceFormat === "raw(base64)") {
    return { sourceFormat, ...buildNormalizedModelFromRaw(rawText, sourceFormat) };
  }
  return {
    sourceFormat,
    model: {
      schemaVersion: 1,
      meta: {
        sourceFormat,
        parserVersion: "normalized-v1",
      },
      nodes: [],
      topology: {},
      policy: {},
      extensions: {
        unknown: {
          contentType: String(contentType || ""),
        },
      },
    },
    warnings: ["unsupported-source-format"],
    lossFlags: sourceFormat === "unknown" ? ["unknown-source-format"] : [],
  };
}

function sourceFormatMatchesOutput(sourceFormat, output) {
  const format = String(sourceFormat || "").trim().toLowerCase();
  const target = String(output || "").trim().toLowerCase();
  if (!format || !target) return false;
  if ((format === "yml" || format === "yaml") && target === OUTPUT_CLASH) return true;
  if (format === "json" && target === OUTPUT_JSON) return true;
  if (format === "raw" && target === OUTPUT_RAW) return true;
  if (format === "raw(base64)" && target === OUTPUT_RAW_BASE64) return true;
  return false;
}

function hasMeaningfulOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") return false;
  return Object.keys(overrides).length > 0;
}

function applyNodeOverrides(node, override = {}) {
  const next = JSON.parse(JSON.stringify(node || {}));
  if (typeof override.name === "string" && override.name.trim()) next.name = override.name.trim();
  if (typeof override.enabled === "boolean") next.enabled = override.enabled;
  if (typeof override.host === "string") next.endpoint.host = override.host.trim();
  if (override.port !== undefined && override.port !== null && Number.isFinite(Number(override.port))) {
    next.endpoint.port = Math.max(0, Number(override.port));
  }
  if (typeof override.uuid === "string") next.auth.uuid = override.uuid.trim();
  if (typeof override.password === "string") next.auth.password = override.password;
  if (typeof override.network === "string") next.transport.network = override.network.trim();
  if (typeof override.path === "string") next.transport.path = override.path;
  if (typeof override.hostHeader === "string") next.transport.host = override.hostHeader;
  if (typeof override.serviceName === "string") next.transport.serviceName = override.serviceName;
  if (typeof override.security === "string") next.security.mode = override.security.trim();
  if (typeof override.sni === "string") next.security.sni = override.sni;
  if (typeof override.fp === "string") next.security.fp = override.fp;
  if (typeof override.pbk === "string") next.security.pbk = override.pbk;
  if (typeof override.sid === "string") next.security.sid = override.sid;
  return next;
}

function applyOverridesToNormalized(normalized, overrides) {
  if (!hasMeaningfulOverrides(overrides)) return normalized;
  const next = JSON.parse(JSON.stringify(normalized || {}));
  const nodeOverrides = overrides?.nodes && typeof overrides.nodes === "object" ? overrides.nodes : {};
  const byId = nodeOverrides.byId && typeof nodeOverrides.byId === "object" ? nodeOverrides.byId : {};
  const byName = nodeOverrides.byName && typeof nodeOverrides.byName === "object" ? nodeOverrides.byName : {};
  const disabledIds = Array.isArray(nodeOverrides.disabledIds) ? new Set(nodeOverrides.disabledIds.map((x) => String(x))) : new Set();

  next.nodes = (Array.isArray(next.nodes) ? next.nodes : [])
    .map((node) => {
      const idKey = String(node?.id || "");
      const nameKey = String(node?.name || "");
      const mergedOverride = {
        ...(byId[idKey] && typeof byId[idKey] === "object" ? byId[idKey] : {}),
        ...(byName[nameKey] && typeof byName[nameKey] === "object" ? byName[nameKey] : {}),
      };
      const applied = applyNodeOverrides(node, mergedOverride);
      if (disabledIds.has(idKey)) applied.enabled = false;
      return applied;
    })
    .filter((node) => node && node.enabled !== false);

  const topologyOverrides = overrides?.topology && typeof overrides.topology === "object" ? overrides.topology : {};
  const policyOverrides = overrides?.policy && typeof overrides.policy === "object" ? overrides.policy : {};

  if (topologyOverrides.proxyGroups) {
    const value = topologyOverrides.proxyGroups;
    if (Array.isArray(value.replace)) next.topology.proxyGroups = value.replace;
    if (value.byName && typeof value.byName === "object") {
      next.topology.proxyGroups = (Array.isArray(next.topology?.proxyGroups) ? next.topology.proxyGroups : []).map((group) => {
        const patch = value.byName[String(group?.name || "")];
        return patch && typeof patch === "object" ? { ...group, ...patch } : group;
      });
    }
  }

  if (topologyOverrides.balancers) {
    const value = topologyOverrides.balancers;
    if (Array.isArray(value.replace)) next.topology.balancers = value.replace;
    if (value.byTag && typeof value.byTag === "object") {
      next.topology.balancers = (Array.isArray(next.topology?.balancers) ? next.topology.balancers : []).map((item) => {
        const patch = value.byTag[String(item?.tag || "")];
        return patch && typeof patch === "object" ? { ...item, ...patch } : item;
      });
    }
  }

  if (topologyOverrides.observatory) {
    const value = topologyOverrides.observatory;
    if (Array.isArray(value.replace)) next.topology.observatory = value.replace;
  }

  if (policyOverrides.rules) {
    const value = policyOverrides.rules;
    if (Array.isArray(value.replace)) next.policy.rules = value.replace;
    if (Array.isArray(value.append) && value.append.length > 0) {
      next.policy.rules = [...(Array.isArray(next.policy?.rules) ? next.policy.rules : []), ...value.append];
    }
  }

  if (policyOverrides.routingRules) {
    const value = policyOverrides.routingRules;
    if (Array.isArray(value.replace)) next.policy.routingRules = value.replace;
    if (Array.isArray(value.append) && value.append.length > 0) {
      next.policy.routingRules = [...(Array.isArray(next.policy?.routingRules) ? next.policy.routingRules : []), ...value.append];
    }
  }

  if (policyOverrides.dns && typeof policyOverrides.dns === "object") {
    next.policy.dns = {
      ...(next.policy?.dns && typeof next.policy.dns === "object" ? next.policy.dns : {}),
      ...policyOverrides.dns,
    };
  }

  next.meta = {
    ...(next.meta && typeof next.meta === "object" ? next.meta : {}),
    overridesApplied: true,
    overrideVersion: Number(overrides?.version || 0) || undefined,
  };
  next.extensions = {
    ...(next.extensions && typeof next.extensions === "object" ? next.extensions : {}),
    overrides: overrides,
  };
  return next;
}

function contentTypeForSnapshotOutput(output) {
  if (output === OUTPUT_JSON) return "application/json; charset=utf-8";
  if (output === OUTPUT_CLASH) return "text/yaml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function encodeRawFromNormalizedNode(node) {
  const uri = String(node?.origin?.uri || "").trim();
  if (uri) return uri;
  return "";
}

function renderRawFromNormalized(normalized) {
  const nodes = Array.isArray(normalized?.nodes) ? normalized.nodes : [];
  return nodes
    .map(encodeRawFromNormalizedNode)
    .filter(Boolean)
    .join("\n");
}

function renderJsonFromNormalized(normalized) {
  const sourceFormat = String(normalized?.meta?.sourceFormat || "").trim().toLowerCase();
  const xrayConfigs = normalized?.extensions?.xray?.configs;
  if (!normalized?.meta?.overridesApplied && sourceFormat === "json" && Array.isArray(xrayConfigs) && xrayConfigs.length > 0) {
    return {
      ok: true,
      body: JSON.stringify(xrayConfigs, null, 2),
      contentType: "application/json; charset=utf-8",
      conversion: "normalized-json-native",
    };
  }

  const rawBody = renderRawFromNormalized(normalized);
  if (!rawBody) {
    return { ok: false, error: "no nodes in normalized snapshot" };
  }
  const configs = buildJsonConfigBundleFromRaw(rawBody);
  return {
    ok: true,
    body: JSON.stringify(configs, null, 2),
    contentType: "application/json; charset=utf-8",
    conversion: "normalized-json",
  };
}

async function renderClashFromNormalized(normalized, options = {}) {
  const sourceFormat = String(normalized?.meta?.sourceFormat || "").trim().toLowerCase();
  const originalText = String(normalized?.extensions?.clash?.originalText || "").trim();
  if (!normalized?.meta?.overridesApplied && sourceFormat === "yml" && originalText) {
    return {
      ok: true,
      body: originalText,
      contentType: "text/yaml; charset=utf-8",
      conversion: "normalized-clash-native",
    };
  }

  if (sourceFormat === "yml" && originalText) {
    let patched = originalText;
    if (normalized?.policy?.dns?.raw) {
      patched = replaceTopLevelYamlSection(patched, "dns", String(normalized.policy.dns.raw));
    }
    if (Array.isArray(normalized?.policy?.rules) && normalized.policy.rules.length > 0) {
      patched = replaceTopLevelYamlSection(
        patched,
        "rules",
        `rules:\n${buildYaml(normalized.policy.rules, 1)}`,
      );
    }
    if (Array.isArray(normalized?.topology?.proxyGroups) && normalized.topology.proxyGroups.length > 0) {
      patched = patchClashProxyGroupsInOriginalText(patched, normalized.topology.proxyGroups);
    }
    return {
      ok: true,
      body: patched,
      contentType: "text/yaml; charset=utf-8",
      conversion: "normalized-clash-patched",
    };
  }

  const rawBody = renderRawFromNormalized(normalized);
  if (!rawBody) return { ok: false, error: "no nodes in normalized snapshot" };
  const produced = await produceOutput(rawBody, OUTPUT_CLASH, options);
  if (!produced.ok) return produced;
  return {
    ...produced,
    conversion: produced.conversion ? `normalized-${produced.conversion}` : "normalized-clash",
  };
}

async function renderOutputFromNormalized(normalized, output, options = {}) {
  if (output === OUTPUT_RAW) {
    const rawBody = renderRawFromNormalized(normalized);
    if (!rawBody) return { ok: false, error: "no nodes in normalized snapshot" };
    return {
      ok: true,
      body: rawBody,
      contentType: "text/plain; charset=utf-8",
      conversion: "normalized-raw",
    };
  }
  if (output === OUTPUT_RAW_BASE64) {
    const rawBody = renderRawFromNormalized(normalized);
    if (!rawBody) return { ok: false, error: "no nodes in normalized snapshot" };
    return {
      ok: true,
      body: Buffer.from(rawBody, "utf8").toString("base64"),
      contentType: "text/plain; charset=utf-8",
      conversion: "normalized-raw+base64",
    };
  }
  if (output === OUTPUT_JSON) {
    return renderJsonFromNormalized(normalized);
  }
  if (output === OUTPUT_CLASH) {
    return renderClashFromNormalized(normalized, options);
  }
  return { ok: false, error: `unsupported output: ${output}` };
}

async function loadLatestStoredSnapshotBundle({ subUrl = "", app = "", device = "", profileNames = [], forwardHeaders = {} }) {
  const feedKey = buildSubscriptionFeedKey({
    subUrl,
    app,
    device,
    profiles: profileNames,
    hwid: String(forwardHeaders?.["x-hwid"] || "").trim(),
  });
  const feed = await getSubscriptionFeedByKey(feedKey);
  if (!feed?.id) return null;
  const sourceSnapshot = await getLatestSourceSnapshotForFeed(feed.id);
  if (!sourceSnapshot) return null;
  const normalizedSnapshot = await getNormalizedSnapshotBySourceSnapshotId(sourceSnapshot.id);
  const overrides = await getSubscriptionOverridesForFeed(feed.id);
  return {
    feed,
    sourceSnapshot,
    normalizedSnapshot,
    overrides,
  };
}

async function respondFromStoredSnapshot(res, bundle, output, options = {}) {
  if (!bundle?.sourceSnapshot) return false;
  const sameFormat = sourceFormatMatchesOutput(bundle.sourceSnapshot.sourceFormat, output) && !hasMeaningfulOverrides(bundle?.overrides?.overrides);
  let body = "";
  let contentType = contentTypeForSnapshotOutput(output);
  let extraHeaders = sanitizeUpstreamResponseHeaders(bundle.sourceSnapshot.responseHeaders || {});

  if (sameFormat) {
    body = readSnapshotFile(bundle.sourceSnapshot.bodyPath);
    contentType =
      String(bundle.sourceSnapshot.responseHeaders?.["content-type"] || "").trim() ||
      String(bundle.sourceSnapshot.responseHeaders?.["Content-Type"] || "").trim() ||
      contentTypeForSnapshotOutput(output);
  } else {
    if (!bundle.normalizedSnapshot?.normalizedPath) return false;
    const normalized = applyOverridesToNormalized(
      JSON.parse(readSnapshotFile(bundle.normalizedSnapshot.normalizedPath)),
      bundle?.overrides ? { ...bundle.overrides.overrides, version: bundle.overrides.version } : null,
    );
    const rendered = await renderOutputFromNormalized(normalized, output, options);
    if (!rendered.ok) return false;
    body = String(rendered.body || "");
    contentType = rendered.contentType || contentType;
  }

  res.writeHead(200, {
    ...extraHeaders,
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
  return true;
}

function extractVlessLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("vless://"));
}

function extractSubscriptionLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(vmess|vless|ss|ssr|trojan):\/\//.test(line));
}

function normalizeJsonNodeName(value, fallback = "node") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function buildXrayStreamSettings(item) {
  const network = String(item?.network || "tcp").trim() || "tcp";
  const security = String(item?.security || "none").trim() || "none";
  const settings = {
    network,
  };

  if (security && security !== "none") settings.security = security;

  if (security === "reality") {
    settings.realitySettings = {
      show: false,
    };
    if (item?.servername) settings.realitySettings.serverName = String(item.servername);
    if (item?.publicKey) settings.realitySettings.publicKey = String(item.publicKey);
    if (item?.shortId) settings.realitySettings.shortId = String(item.shortId);
    if (item?.clientFingerprint) settings.realitySettings.fingerprint = String(item.clientFingerprint);
  } else if (security === "tls" || security === "xtls") {
    settings.tlsSettings = {};
    if (item?.servername) settings.tlsSettings.serverName = String(item.servername);
    const alpn = String(item?.transport?.alpn || "").trim();
    if (alpn) settings.tlsSettings.alpn = alpn.split(",").map((part) => part.trim()).filter(Boolean);
    if (item?.clientFingerprint) settings.tlsSettings.fingerprint = String(item.clientFingerprint);
  }

  if (network === "ws") {
    settings.wsSettings = {};
    if (item?.path) settings.wsSettings.path = String(item.path);
    if (item?.host) settings.wsSettings.headers = { Host: String(item.host) };
  } else if (network === "grpc") {
    settings.grpcSettings = {};
    if (item?.serviceName) settings.grpcSettings.serviceName = String(item.serviceName);
    if (item?.transport?.authority) settings.grpcSettings.authority = String(item.transport.authority);
    if (item?.transport?.mode) settings.grpcSettings.mode = String(item.transport.mode) === "gun";
  } else if (network === "tcp" && item?.transport?.headerType) {
    settings.tcpSettings = {
      header: { type: String(item.transport.headerType) },
    };
  }

  return settings;
}

function buildXrayOutboundFromImportedItem(item, index) {
  const protocol = String(item?.type || "").toLowerCase();
  const name = normalizeJsonNodeName(item?.name, `node-${index + 1}`);
  const tag = `node-${String(index + 1).padStart(4, "0")}`;
  const server = String(item?.server || "").trim();
  const port = Number(item?.port || 0);
  if (!server || !port) return null;

  if (protocol === "vless") {
    const user = {
      id: String(item?.uuid || "").trim(),
      encryption: "none",
    };
    if (item?.flow) user.flow = String(item.flow);
    return {
      tag,
      protocol: "vless",
      settings: {
        vnext: [
          {
            address: server,
            port,
            users: [user],
          },
        ],
      },
      streamSettings: buildXrayStreamSettings(item),
      remarks: name,
    };
  }

  if (protocol === "trojan") {
    return {
      tag,
      protocol: "trojan",
      settings: {
        servers: [
          {
            address: server,
            port,
            password: String(item?.password || ""),
          },
        ],
      },
      streamSettings: buildXrayStreamSettings(item),
      remarks: name,
    };
  }

  if (protocol === "vmess") {
    return {
      tag,
      protocol: "vmess",
      settings: {
        vnext: [
          {
            address: server,
            port,
            users: [
              {
                id: String(item?.uuid || "").trim(),
                alterId: Number(item?.transport?.aid || 0),
                security: "auto",
              },
            ],
          },
        ],
      },
      streamSettings: buildXrayStreamSettings(item),
      remarks: name,
    };
  }

  if (protocol === "ss") {
    return {
      tag,
      protocol: "shadowsocks",
      settings: {
        servers: [
          {
            address: server,
            port,
            method: "",
            password: String(item?.password || ""),
          },
        ],
      },
      remarks: name,
    };
  }

  if (protocol === "ssr") {
    return {
      tag,
      protocol: "shadowsocks",
      settings: {
        servers: [
          {
            address: server,
            port,
            method: String(item?.transport?.method || ""),
            password: String(item?.password || ""),
          },
        ],
      },
      remarks: name,
    };
  }

  return null;
}

function buildJsonConfigBundleFromRaw(rawText) {
  const parsed = parseBulkProxyText(rawText);
  const configs = parsed
    .map((item, index) => {
      const outbound = buildXrayOutboundFromImportedItem(item, index);
      if (!outbound) return null;
      return {
        remarks: normalizeJsonNodeName(item.name, `node-${index + 1}`),
        log: {
          loglevel: "warning",
        },
        dns: {
          servers: ["8.8.8.8", "1.1.1.1"],
          queryStrategy: "UseIPv4",
        },
        inbounds: [
          {
            tag: "socks",
            port: 10808,
            listen: "127.0.0.1",
            protocol: "socks",
            settings: {
              udp: true,
              auth: "noauth",
            },
          },
          {
            tag: "http",
            port: 10809,
            listen: "127.0.0.1",
            protocol: "http",
            settings: {},
          },
        ],
        outbounds: [
          outbound,
          { tag: "direct", protocol: "freedom" },
          { tag: "block", protocol: "blackhole" },
        ],
        routing: {
          domainStrategy: "AsIs",
          rules: [
            {
              type: "field",
              protocol: ["bittorrent"],
              outboundTag: "block",
            },
            {
              type: "field",
              outboundTag: outbound.tag,
            },
          ],
        },
      };
    })
    .filter(Boolean);

  return configs;
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

function sanitizeNodeName(value, fallback = "node") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function buildNodeName(baseName, outboundTag, totalOutbounds, outboundIndex) {
  const base = sanitizeNodeName(baseName, "node");
  const tag = sanitizeNodeName(outboundTag, "");
  if (totalOutbounds <= 1) return base;
  if (tag) return `${base} ${tag}`;
  return `${base} ${outboundIndex + 1}`;
}

function appendSearchParamIfPresent(params, key, value) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!text) return;
  params.set(key, text);
}

function extractRawUrisFromJsonConfig(parsed) {
  const configs = Array.isArray(parsed) ? parsed : [parsed];
  const lines = [];

  for (const [configIndex, config] of configs.entries()) {
    if (!config || typeof config !== "object") continue;
    const outbounds = Array.isArray(config.outbounds) ? config.outbounds : [];
    const proxyOutbounds = outbounds.filter((outbound) => String(outbound?.protocol || "").toLowerCase() === "vless");
    const totalOutbounds = proxyOutbounds.length;
    const baseName = sanitizeNodeName(config.remarks, `node-${configIndex + 1}`);

    for (const [outboundIndex, outbound] of proxyOutbounds.entries()) {
      const vnext = outbound?.settings?.vnext?.[0];
      const user = vnext?.users?.[0];
      const address = String(vnext?.address || "").trim();
      const uuid = String(user?.id || "").trim();
      if (!address || !uuid) continue;

      const port = Number(vnext?.port || 443);
      const stream = outbound?.streamSettings || {};
      const security = String(stream.security || "none").trim() || "none";
      const network = String(stream.network || "tcp").trim() || "tcp";
      const params = new URLSearchParams();
      params.set("type", network);
      params.set("security", security);

      appendSearchParamIfPresent(params, "flow", user?.flow);
      appendSearchParamIfPresent(params, "encryption", user?.encryption);

      if (security === "reality") {
        const reality = stream.realitySettings || {};
        appendSearchParamIfPresent(params, "sni", reality.serverName);
        appendSearchParamIfPresent(params, "fp", reality.fingerprint);
        appendSearchParamIfPresent(params, "pbk", reality.publicKey);
        appendSearchParamIfPresent(params, "sid", reality.shortId);
      } else if (security === "tls" || security === "xtls") {
        const tls = stream.tlsSettings || {};
        appendSearchParamIfPresent(params, "sni", tls.serverName);
        appendSearchParamIfPresent(params, "alpn", Array.isArray(tls.alpn) ? tls.alpn.join(",") : tls.alpn);
      }

      if (network === "ws") {
        const ws = stream.wsSettings || {};
        appendSearchParamIfPresent(params, "path", ws.path);
        appendSearchParamIfPresent(params, "host", ws.headers?.Host || ws.headers?.host);
      } else if (network === "grpc") {
        const grpc = stream.grpcSettings || {};
        appendSearchParamIfPresent(params, "serviceName", grpc.serviceName);
        appendSearchParamIfPresent(params, "authority", grpc.authority);
        if (grpc.mode === true || grpc.mode === "gun") params.set("mode", "gun");
      } else if (network === "tcp" && stream.tcpSettings?.header?.type) {
        appendSearchParamIfPresent(params, "headerType", stream.tcpSettings.header.type);
      }

      const name = buildNodeName(baseName, outbound.tag, totalOutbounds, outboundIndex);
      lines.push(`vless://${encodeURIComponent(uuid)}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "";
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

function wrapClashProviderForFlClash(yamlText) {
  const text = String(yamlText || "").trim();
  if (!shouldWrapClashProviderForFlClash(text)) return text;

  const proxyNames = parseClashProxyList(text)
    .map((proxy) => sanitizeNodeName(proxy?.name, "proxy"))
    .filter(Boolean);
  if (proxyNames.length === 0) return text;

  const proxyGroups = [
    {
      name: "AUTO",
      type: "url-test",
      url: "http://www.gstatic.com/generate_204",
      interval: 300,
      tolerance: 50,
      proxies: proxyNames,
    },
    {
      name: "PROXY",
      type: "select",
      proxies: ["AUTO", "DIRECT", ...proxyNames],
    },
  ];
  const rules = ["MATCH,PROXY"];

  return [
    "mixed-port: 7890",
    "allow-lan: false",
    "mode: rule",
    "log-level: info",
    "unified-delay: true",
    text,
    `proxy-groups:\n${buildYaml(proxyGroups, 1)}`,
    `rules:\n${buildYaml(rules, 1)}`,
  ].join("\n");
}

function parseInlineYamlMap(body) {
  const trimmed = String(body || "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};
  const out = {};
  for (const part of inner.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = unquoteYamlValue(value);
  }
  return out;
}

function normalizeYamlKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function normalizeYamlScalarValue(value) {
  const raw = String(value || "").trim();
  return unquoteYamlValue(raw);
}

function parseClashProxyList(yamlText) {
  const text = String(yamlText || "").replace(/\t/g, "  ");
  const lines = text.split(/\r?\n/);
  const proxies = [];
  let inProxies = false;
  let current = null;
  let currentIndent = -1;

  function pushCurrent() {
    if (!current) return;
    if (Object.keys(current).length > 0) proxies.push(current);
    current = null;
    currentIndent = -1;
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!inProxies) {
      if (/^proxies\s*:\s*$/i.test(trimmed)) inProxies = true;
      continue;
    }

    const newTopLevel = rawLine.match(/^([A-Za-z0-9_.-]+)\s*:/);
    if (newTopLevel && !rawLine.startsWith(" ") && !rawLine.startsWith("-")) {
      pushCurrent();
      break;
    }

    const item = rawLine.match(/^(\s*)-\s*(.*)$/);
    if (item) {
      pushCurrent();
      current = {};
      currentIndent = item[1].length;
      const body = (item[2] || "").trim();
      if (body) {
        const inlineMap = parseInlineYamlMap(body);
        if (inlineMap) {
          Object.assign(current, inlineMap);
        } else {
          const pair = body.match(/^(['"]?[A-Za-z0-9_.-]+['"]?)\s*:\s*(.*)$/);
          if (pair) current[normalizeYamlKey(pair[1])] = normalizeYamlScalarValue(pair[2] || "");
        }
      }
      continue;
    }

    if (!current) continue;
    const kv = rawLine.match(/^(\s*)(['"]?[A-Za-z0-9_.-]+['"]?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const indent = kv[1].length;
    if (indent <= currentIndent) continue;
    current[normalizeYamlKey(kv[2])] = normalizeYamlScalarValue(kv[3] || "");
  }

  pushCurrent();
  return proxies;
}

function extractTopLevelYamlSection(yamlText, sectionName) {
  const text = String(yamlText || "").replace(/\t/g, "  ");
  const lines = text.split(/\r?\n/);
  const target = String(sectionName || "").trim();
  if (!target) return "";
  const out = [];
  let collecting = false;

  for (const line of lines) {
    const topLevelMatch = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!collecting) {
      if (topLevelMatch && topLevelMatch[1] === target) {
        collecting = true;
        out.push(line);
      }
      continue;
    }
    if (topLevelMatch && !line.startsWith(" ") && !line.startsWith("\t")) break;
    out.push(line);
  }

  return out.join("\n").trimEnd();
}

function parseYamlListBlocks(sectionText) {
  const text = String(sectionText || "").trim();
  if (!text) return [];
  const body = text.replace(/^[A-Za-z0-9_.-]+\s*:\s*\n?/i, "");
  return body
    .split(/\n(?=\s*-\s+)/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("-"));
}

function parseClashProxyGroups(yamlText) {
  const section = extractTopLevelYamlSection(yamlText, "proxy-groups");
  if (!section) return [];
  return parseYamlListBlocks(section)
    .map((block) => {
      const normalizedBlock = String(block || "").replace(/^(\s*)-\s*/, "$1");
      const flat = parseYamlProxyBlock(normalizedBlock);
      return {
        name: String(flat.name || "").trim(),
        type: String(flat.type || "").trim(),
        proxies: Array.isArray(flat.proxies) ? flat.proxies : (flat.proxies ? [flat.proxies] : []),
        url: String(flat.url || "").trim(),
        interval: String(flat.interval || "").trim(),
        tolerance: String(flat.tolerance || "").trim(),
        flat,
      };
    })
    .filter((item) => item.name);
}

function parseClashRules(yamlText) {
  const section = extractTopLevelYamlSection(yamlText, "rules");
  if (!section) return [];
  return parseYamlListBlocks(section)
    .map((block) => String(block || "").replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function replaceTopLevelYamlSection(yamlText, sectionName, replacementText) {
  const text = String(yamlText || "").replace(/\t/g, "  ");
  const target = String(sectionName || "").trim();
  if (!target) return text;
  const lines = text.split(/\r?\n/);
  const out = [];
  let replaced = false;
  let skipping = false;

  for (const line of lines) {
    const topLevelMatch = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (skipping) {
      if (topLevelMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
        skipping = false;
      } else {
        continue;
      }
    }
    if (!skipping && topLevelMatch && topLevelMatch[1] === target) {
      if (replacementText) out.push(String(replacementText).trimEnd());
      replaced = true;
      skipping = true;
      continue;
    }
    out.push(line);
  }

  if (!replaced && replacementText) out.push(String(replacementText).trimEnd());
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function patchClashProxyGroupsInOriginalText(originalText, proxyGroups) {
  let next = String(originalText || "");
  for (const group of Array.isArray(proxyGroups) ? proxyGroups : []) {
    const name = String(group?.name || "").trim();
    if (!name) continue;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockPattern = new RegExp(`((?:^|\\n)\\s*-\\s+name\\s*:\\s*${escapedName}\\s*[\\s\\S]*?)(?=\\n\\s*-\\s+name\\s*:|\\n[A-Za-z0-9_.-]+\\s*:|$)`, "m");
    const match = next.match(blockPattern);
    if (!match) continue;
    let block = match[1];
    for (const [field, value] of Object.entries(group || {})) {
      if (field === "name" || field === "proxies" || field === "flat") continue;
      const text = String(value || "").trim();
      if (!text) continue;
      const fieldPattern = new RegExp(`(^\\s*${field}\\s*:\\s*).*$`, "m");
      if (fieldPattern.test(block)) {
        block = block.replace(fieldPattern, `$1${text}`);
      }
    }
    next = next.replace(blockPattern, block);
  }
  return next;
}

function parseYamlProxyBlock(block) {
  const text = String(block || "").replace(/\t/g, "  ");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const flat = {};
  const stack = [];

  function stackPath() {
    return stack.map((entry) => entry.key).join(".");
  }

  function setValue(path, value) {
    if (!path) return;
    flat[path] = value;
  }

  function pushListValue(path, value) {
    if (!path) return;
    const existing = flat[path];
    if (Array.isArray(existing)) {
      existing.push(value);
      return;
    }
    if (existing !== undefined) {
      flat[path] = [existing, value];
      return;
    }
    flat[path] = [value];
  }

  for (const rawLine of lines) {
    const item = rawLine.match(/^(\s*)-\s*(.*)$/);
    if (item) {
      const indent = item[1].length;
      const value = normalizeYamlScalarValue(item[2] || "");
      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      pushListValue(stackPath(), value);
      continue;
    }

    const kv = rawLine.match(/^(\s*)(['"]?[^'":]+['"]?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const indent = kv[1].length;
    const key = normalizeYamlKey(kv[2]);
    const value = normalizeYamlScalarValue(kv[3] || "");

    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const path = [...stack.map((entry) => entry.key), key].join(".");
    if (value) {
      setValue(path, value);
      continue;
    }
    stack.push({ key, indent });
  }

  return flat;
}

function buildRawUriFromProxy(proxy) {
  const type = String(proxy.type || "").toLowerCase();
  const name = encodeURIComponent(String(proxy.name || proxy.server || "proxy"));
  const server = String(proxy.server || "").trim();
  const port = Number(proxy.port || 0);
  if (!server || !port) return "";

  if (type === "ss") {
    const cipher = String(proxy.cipher || "").trim();
    const password = String(proxy.password || "").trim();
    if (!cipher || !password) return "";
    const userInfo = Buffer.from(`${cipher}:${password}`, "utf8").toString("base64");
    return `ss://${userInfo}@${server}:${port}#${name}`;
  }

  if (type === "trojan") {
    const password = String(proxy.password || "").trim();
    if (!password) return "";
    const params = new URLSearchParams();
    if (proxy.sni || proxy.servername) params.set("sni", String(proxy.sni || proxy.servername));
    if (proxy["skip-cert-verify"] === "true" || proxy["skip-cert-verify"] === true) {
      params.set("allowInsecure", "1");
    }
    const query = params.toString();
    return `trojan://${encodeURIComponent(password)}@${server}:${port}${query ? `?${query}` : ""}#${name}`;
  }

  if (type === "ssr") {
    const protocol = String(proxy.protocol || "origin").trim();
    const method = String(proxy.cipher || proxy.method || "").trim();
    const obfs = String(proxy.obfs || "plain").trim();
    const password = String(proxy.password || "").trim();
    if (!method || !password) return "";
    const pwd64 = Buffer.from(password, "utf8").toString("base64").replace(/=+$/g, "");
    const protocolParam = String(proxy["protocol-param"] || proxy.protocolparam || "").trim();
    const obfsParam = String(proxy["obfs-param"] || proxy.obfsparam || "").trim();
    const remarks = decodeURIComponent(name);
    const qs = new URLSearchParams();
    if (obfsParam) qs.set("obfsparam", Buffer.from(obfsParam, "utf8").toString("base64").replace(/=+$/g, ""));
    if (protocolParam) qs.set("protoparam", Buffer.from(protocolParam, "utf8").toString("base64").replace(/=+$/g, ""));
    qs.set("remarks", Buffer.from(remarks, "utf8").toString("base64").replace(/=+$/g, ""));
    const payload = `${server}:${port}:${protocol}:${method}:${obfs}:${pwd64}/?${qs.toString()}`;
    return `ssr://${Buffer.from(payload, "utf8").toString("base64")}`;
  }

  if (type === "vless") {
    const uuid = String(proxy.uuid || "").trim();
    if (!uuid) return "";
    const params = new URLSearchParams();
    const network = String(proxy.network || "tcp").trim() || "tcp";
    const hasReality = Boolean(proxy["reality-opts.public-key"] || proxy["reality-opts.short-id"]);
    const security = hasReality
      ? "reality"
      : (proxy.tls === "true" || proxy.tls === true ? "tls" : "none");
    params.set("type", network);
    params.set("security", security);
    if (proxy.servername || proxy.sni) params.set("sni", String(proxy.servername || proxy.sni));
    if (proxy.flow) params.set("flow", String(proxy.flow));
    if (proxy["client-fingerprint"]) params.set("fp", String(proxy["client-fingerprint"]));
    if (proxy["packet-encoding"]) params.set("packetEncoding", String(proxy["packet-encoding"]));
    if (hasReality) {
      if (proxy["reality-opts.public-key"]) params.set("pbk", String(proxy["reality-opts.public-key"]));
      if (proxy["reality-opts.short-id"]) params.set("sid", String(proxy["reality-opts.short-id"]));
    }
    const alpn = Array.isArray(proxy.alpn) ? proxy.alpn.join(",") : String(proxy.alpn || "").trim();
    if (alpn) params.set("alpn", alpn);
    if (network === "ws") {
      if (proxy["ws-opts.path"]) params.set("path", String(proxy["ws-opts.path"]));
      if (proxy["ws-opts.headers.Host"] || proxy["ws-opts.headers.host"]) {
        params.set("host", String(proxy["ws-opts.headers.Host"] || proxy["ws-opts.headers.host"]));
      }
    } else if (network === "grpc") {
      if (proxy["grpc-opts.service-name"] || proxy["grpc-opts.serviceName"]) {
        params.set("serviceName", String(proxy["grpc-opts.service-name"] || proxy["grpc-opts.serviceName"]));
      }
      if (proxy["grpc-opts.authority"]) params.set("authority", String(proxy["grpc-opts.authority"]));
    } else if (network === "http") {
      const path = Array.isArray(proxy["http-opts.path"]) ? proxy["http-opts.path"][0] : proxy["http-opts.path"];
      const host = Array.isArray(proxy["http-opts.headers.Host"]) ? proxy["http-opts.headers.Host"][0] : proxy["http-opts.headers.Host"];
      if (path) params.set("path", String(path));
      if (host) params.set("host", String(host));
    } else if (network === "tcp" && proxy["tcp-opts.header.type"]) {
      params.set("headerType", String(proxy["tcp-opts.header.type"]));
    }
    return `vless://${uuid}@${server}:${port}?${params.toString()}#${name}`;
  }

  if (type === "vmess") {
    const uuid = String(proxy.uuid || "").trim();
    if (!uuid) return "";
    const vmess = {
      v: "2",
      ps: decodeURIComponent(name),
      add: server,
      port: String(port),
      id: uuid,
      aid: String(proxy.alterId || proxy.alterid || 0),
      net: String(proxy.network || "tcp"),
      type: "none",
      host: String(proxy.host || ""),
      path: String(proxy.path || ""),
      tls: proxy.tls === "true" || proxy.tls === true ? "tls" : "",
      sni: String(proxy.servername || proxy.sni || ""),
    };
    const encoded = Buffer.from(JSON.stringify(vmess), "utf8").toString("base64");
    return `vmess://${encoded}`;
  }

  return "";
}

function convertClashYamlToRawUris(yamlText) {
  const text = String(yamlText || "");
  const proxies = parseClashProxyList(text);
  let lines = proxies.map(buildRawUriFromProxy).filter(Boolean);
  if (lines.length > 0) return lines.join("\n");

  const sectionMatch = text.match(/(?:^|\n)proxies\s*:\s*\n([\s\S]*)$/i);
  const section = sectionMatch ? sectionMatch[1] : "";
  if (!section) return "";
  const blocks = section
    .split(/\n(?=\s*-\s+name\s*:)/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("- name:"));

  function getField(block, key) {
    const re = new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*(.+)$`, "m");
    const m = block.match(re);
    return m ? normalizeYamlScalarValue(m[1]) : "";
  }

  const regexProxies = blocks.map((block) => {
    const flat = parseYamlProxyBlock(block);
    return {
      name: normalizeYamlScalarValue(block.replace(/^-+\s*name\s*:\s*/i, "").split(/\n/)[0] || ""),
      type: flat.type || getField(block, "type"),
      server: flat.server || getField(block, "server"),
      port: flat.port || getField(block, "port"),
      network: flat.network || getField(block, "network"),
      tls: flat.tls || getField(block, "tls"),
      servername: flat.servername || getField(block, "servername"),
      sni: flat.sni || getField(block, "sni"),
      uuid: flat.uuid || getField(block, "uuid"),
      cipher: flat.cipher || getField(block, "cipher"),
      method: flat.method || getField(block, "method"),
      password: flat.password || getField(block, "password"),
      obfs: flat.obfs || getField(block, "obfs"),
      protocol: flat.protocol || getField(block, "protocol"),
      flow: flat.flow || getField(block, "flow"),
      "client-fingerprint": flat["client-fingerprint"] || getField(block, "client-fingerprint"),
      "packet-encoding": flat["packet-encoding"] || getField(block, "packet-encoding"),
      alpn: flat.alpn || getField(block, "alpn"),
      "protocol-param": flat["protocol-param"] || getField(block, "protocol-param"),
      "obfs-param": flat["obfs-param"] || getField(block, "obfs-param"),
      "reality-opts.public-key": flat["reality-opts.public-key"] || "",
      "reality-opts.short-id": flat["reality-opts.short-id"] || "",
      "ws-opts.path": flat["ws-opts.path"] || "",
      "ws-opts.headers.Host": flat["ws-opts.headers.Host"] || flat["ws-opts.headers.host"] || "",
      "grpc-opts.service-name": flat["grpc-opts.service-name"] || flat["grpc-opts.serviceName"] || "",
      "grpc-opts.authority": flat["grpc-opts.authority"] || "",
      "http-opts.path": flat["http-opts.path"] || "",
      "http-opts.headers.Host": flat["http-opts.headers.Host"] || flat["http-opts.headers.host"] || "",
      "tcp-opts.header.type": flat["tcp-opts.header.type"] || "",
    };
  });

  lines = regexProxies.map(buildRawUriFromProxy).filter(Boolean);
  return lines.join("\n");
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

function cacheKey(subUrl, output, profileKey = "") {
  return sha1(`${subUrl}|${output}|${profileKey}`);
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
      key === "x-output" ||
      key === "x-app" ||
      key === "x-device" ||
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

function parseOptionalOutput(v) {
  const value = firstHeaderValue(v);
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeOutput(value);
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
    output: undefined,
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
      } else if (key === "output") {
        if (value !== "") {
          const normalizedOutput = normalizeOutput(value);
          if (normalizedOutput) profile.output = normalizedOutput;
        }
      } else if (key === "use_converter") {
        if (value !== "") profile.output = parseBool(value, false) ? OUTPUT_CLASH : OUTPUT_RAW;
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

function profileSearchDirs(profileName) {
  const dirs = [];
  for (const root of PROFILE_ROOT_DIRS) {
    dirs.push(path.join(root, "profiles"));
    dirs.push(path.join(root, "base"));
    dirs.push(root);
  }
  return dirs.filter((dir, i, arr) => arr.indexOf(dir) === i);
}

function resolveProfilePath(profileName) {
  for (const dir of profileSearchDirs(profileName)) {
    const ymlPath = path.join(dir, `${profileName}.yml`);
    const yamlPath = path.join(dir, `${profileName}.yaml`);
    if (fs.existsSync(ymlPath)) return ymlPath;
    if (fs.existsSync(yamlPath)) return yamlPath;
  }
  return "";
}

function readProfileFile(profileName) {
  const filePath = resolveProfilePath(profileName);
  if (!filePath) return null;
  const content = fs.readFileSync(filePath, "utf8");
  return parseProfileYaml(content);
}

function profileExists(profileName) {
  return Boolean(resolveProfilePath(profileName));
}

function sanitizeProfileToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(token)) return "";
  return token;
}

function defaultUaCatalog() {
  return {
    __default__: "SubLab/UA Default (Windows)",
    windows: {
      flclashx: "FlClash X/0.8.74 (Windows 11; Win64; x64)",
      happ: "Happ/1.2.0 (Windows 11; Win64; x64)",
    },
  };
}

function readUaCatalog() {
  try {
    if (!fs.existsSync(UA_CATALOG_PATH)) return defaultUaCatalog();
    const parsed = JSON.parse(fs.readFileSync(UA_CATALOG_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return defaultUaCatalog();
    }
    return parsed;
  } catch {
    return defaultUaCatalog();
  }
}

function getUaCatalogOptions() {
  const raw = readUaCatalog();
  const options = {};
  for (const [osKey, apps] of Object.entries(raw)) {
    if (osKey === "__default__") continue;
    if (!apps || typeof apps !== "object" || Array.isArray(apps)) continue;
    const appMap = {};
    for (const [appKey, ua] of Object.entries(apps)) {
      const safeApp = sanitizeProfileToken(appKey);
      if (!safeApp) continue;
      const text = String(ua || "").trim();
      if (!text) continue;
      appMap[safeApp] = text;
    }
    if (Object.keys(appMap).length > 0) {
      const safeOs = sanitizeProfileToken(osKey);
      if (safeOs) options[safeOs] = appMap;
    }
  }
  const defaultUa = typeof raw.__default__ === "string" && raw.__default__.trim()
    ? raw.__default__.trim()
    : "";
  return { options, defaultUa };
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

function pickUserAgentProfile(app, device) {
  const { options, defaultUa } = getUaCatalogOptions();
  const appToken = sanitizeProfileToken(app);
  const deviceToken = sanitizeProfileToken(device);
  if (!appToken && !deviceToken) {
    return defaultUa
      ? { ok: true, headers: { "user-agent": defaultUa }, source: "default" }
      : { ok: true, headers: {}, source: "" };
  }
  if (!appToken && deviceToken) {
    return { ok: false, error: "app is required when device is provided" };
  }

  if (deviceToken) {
    const perOs = options[deviceToken];
    if (perOs && perOs[appToken]) {
      return {
        ok: true,
        headers: { "user-agent": perOs[appToken] },
        source: `${deviceToken}:${appToken}`,
      };
    }
  }

  if (!deviceToken) {
    for (const [osKey, appMap] of Object.entries(options)) {
      if (appMap && appMap[appToken]) {
        return {
          ok: true,
          headers: { "user-agent": appMap[appToken] },
          source: `${osKey}:${appToken}`,
        };
      }
    }
  }

  if (defaultUa) {
    return { ok: true, headers: { "user-agent": defaultUa }, source: "default" };
  }
  return { ok: true, headers: {}, source: "" };
}

function mergeProfiles(profileNames) {
  const merged = {
    subUrl: "",
    output: undefined,
    headerPolicy: HEADER_POLICY_DEFAULT,
    allowHwidOverride: true,
    headers: {},
    requiredHeaders: [],
    lockedHeaders: {},
  };
  for (const name of profileNames) {
    const profile = readProfileFile(name);
    if (!profile) {
      return { ok: false, error: `profile not found: ${name}` };
    }
    if (profile.subUrl) merged.subUrl = profile.subUrl;
    if (profile.output) merged.output = profile.output;
    if (profile.headerPolicy) merged.headerPolicy = profile.headerPolicy;
    merged.allowHwidOverride = profile.allowHwidOverride !== false;
    merged.headers = { ...merged.headers, ...profile.headers };
    if (name.startsWith("ua-")) {
      for (const [k, v] of Object.entries(profile.headers || {})) {
        if (v !== undefined && v !== null && v !== "") {
          merged.lockedHeaders[k] = String(v);
        }
      }
    }
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

function resolveForwardHeaders(reqHeaders, profile, hwidFromQuery, hwidFromHeader) {
  const incoming = sanitizeForwardHeaders(reqHeaders);
  const fromProfile = { ...profile.headers };
  const lockedHeaders = profile.lockedHeaders && typeof profile.lockedHeaders === "object"
    ? profile.lockedHeaders
    : {};

  // Query hwid (UI override) always wins.
  if (hwidFromQuery) {
    fromProfile["x-hwid"] = hwidFromQuery;
  } else if (hwidFromHeader && profile.allowHwidOverride !== false) {
    // Client-provided x-hwid can override only when profile allows it.
    fromProfile["x-hwid"] = hwidFromHeader;
  }

  // When override is disabled in profile, ignore client x-hwid header.
  if (profile.allowHwidOverride === false) {
    delete incoming["x-hwid"];
  }

  if (profile.headerPolicy === "require_request") {
    for (const required of profile.requiredHeaders) {
      if (!incoming[required]) {
        return { ok: false, error: `required header is missing: ${required}` };
      }
    }
  }

  const merged =
    profile.headerPolicy === "file_only"
      ? { ...incoming, ...fromProfile }
      : { ...fromProfile, ...incoming };
  for (const [k, v] of Object.entries(lockedHeaders)) {
    merged[k] = v;
  }
  if (hwidFromQuery) {
    merged["x-hwid"] = hwidFromQuery;
  }
  return { ok: true, headers: merged };
}

function resolveRequestConfig(reqUrl, reqHeaders, forcedProfileName = "") {
  const profileNames = pickProfileNames(reqUrl, reqHeaders, forcedProfileName);
  const app = sanitizeProfileToken(
    reqUrl.searchParams.get("app") ?? firstHeaderValue(reqHeaders["x-app"]),
  );
  const device = sanitizeProfileToken(
    reqUrl.searchParams.get("device") ?? firstHeaderValue(reqHeaders["x-device"]),
  );
  const uaProfile = pickUserAgentProfile(app, device);
  if (!uaProfile.ok) {
    return { ok: false, status: 400, error: uaProfile.error };
  }

  const merged = mergeProfiles(profileNames);
  if (!merged.ok) {
    return { ok: false, status: 400, error: merged.error };
  }
  if (uaProfile.headers && uaProfile.headers["user-agent"]) {
    merged.profile.headers["user-agent"] = uaProfile.headers["user-agent"];
    merged.profile.lockedHeaders["user-agent"] = uaProfile.headers["user-agent"];
  }

  const subFromQuery = reqUrl.searchParams.get("sub_url");
  const subFromHeader = firstHeaderValue(reqHeaders["x-sub-url"]);
  const subUrl = subFromQuery || subFromHeader || merged.profile.subUrl || SUB_URL_DEFAULT;

  const outputFromQuery = reqUrl.searchParams.get("output");
  const outputFromHeader = reqHeaders["x-output"];
  const explicitOutput = parseOptionalOutput(outputFromQuery ?? outputFromHeader);
  if ((outputFromQuery || outputFromHeader) && !explicitOutput) {
    return { ok: false, status: 400, error: "unsupported output (use: clash|yml|yaml|raw|raw_base64|json)" };
  }

  const legacyFromQuery = reqUrl.searchParams.get("use_converter");
  const legacyFromHeader = reqHeaders["x-use-converter"];
  const explicitLegacyUseConverter = parseOptionalBool(legacyFromQuery ?? legacyFromHeader);
  const output =
    explicitOutput ??
    (explicitLegacyUseConverter !== undefined
      ? explicitLegacyUseConverter
        ? OUTPUT_CLASH
        : OUTPUT_RAW
      : merged.profile.output || OUTPUT_DEFAULT);

  const hwidFromQuery = String(reqUrl.searchParams.get("hwid") || "").trim();
  const hwidFromHeader = String(firstHeaderValue(reqHeaders["x-hwid"]) || "").trim();
  const resolvedHeaders = resolveForwardHeaders(reqHeaders, merged.profile, hwidFromQuery, hwidFromHeader);
  if (!resolvedHeaders.ok) {
    return { ok: false, status: 400, error: resolvedHeaders.error };
  }

  return {
    ok: true,
    subUrl,
    output,
    app,
    device,
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

function resolveRequesterId(req) {
  if (!req || typeof req !== "object") return "";
  const forwardedFor = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const remote = String(req.socket?.remoteAddress || req.connection?.remoteAddress || "").trim();
  return forwardedFor || remote;
}

function buildSnapshotRequestContext({ route = "", output = "", profileNames = [], app = "", device = "", forwardHeaders = {}, req = null } = {}) {
  return {
    route: String(route || "").trim(),
    output: String(output || "").trim(),
    profileNames: Array.isArray(profileNames) ? profileNames.map((item) => String(item || "").trim()).filter(Boolean) : [],
    app: String(app || "").trim(),
    device: String(device || "").trim(),
    forwardHeaders: sanitizeForwardHeaders(forwardHeaders || {}),
    requestPath: req?.url ? String(req.url) : "",
    requesterId: resolveRequesterId(req),
  };
}

async function persistSuccessfulSourceSnapshot({
  req = null,
  route = "",
  subUrl = "",
  output = "",
  profileNames = [],
  app = "",
  device = "",
  forwardHeaders = {},
  fetched,
}) {
  if (!fetched || Number(fetched.responseStatus || 0) < 200 || Number(fetched.responseStatus || 0) >= 300) {
    return null;
  }
  const body = String(fetched.body || "");
  if (!body) return null;

  const feed = await upsertSubscriptionFeed({
    subUrl,
    app,
    device,
    profiles: profileNames,
    hwid: String(forwardHeaders?.["x-hwid"] || "").trim(),
  });
  const storedBody = writeRawSourceSnapshotBody(
    `${feed.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    body,
  );
  const contentType =
    String(fetched.responseHeaders?.["content-type"] || "").trim() ||
    String(fetched.responseHeaders?.["Content-Type"] || "").trim();
  const sourceFormat = detectSourceFormat(body, contentType);
  const sourceSnapshot = await createSourceSnapshot({
    feedId: feed.id,
    fetchedAt: new Date().toISOString(),
    fetchedByType: route ? `route:${route}` : "route",
    fetchedById: resolveRequesterId(req),
    requestContext: buildSnapshotRequestContext({
      route,
      output,
      profileNames,
      app,
      device,
      forwardHeaders,
      req,
    }),
    responseStatus: fetched.responseStatus,
    responseUrl: fetched.responseUrl,
    responseHeaders: fetched.responseHeaders || {},
    bodyPath: storedBody.path,
    bodySha256: storedBody.sha256,
    bodyBytes: storedBody.bytes,
    sourceFormat,
    sourceFormatDetails: {
      contentType,
      detectedAt: new Date().toISOString(),
    },
  });
  const normalized = buildNormalizedModelFromSource(body, contentType);
  const normalizedStored = writeNormalizedSnapshotFile(
    `${sourceSnapshot.id}-normalized-v1`,
    normalized.model,
  );
  await createNormalizedSnapshot({
    feedId: feed.id,
    sourceSnapshotId: sourceSnapshot.id,
    schemaVersion: Number(normalized.model?.schemaVersion || 1),
    parserVersion: "normalized-v1",
    normalizedPath: normalizedStored.path,
    normalizedSha256: normalizedStored.sha256,
    warnings: Array.isArray(normalized.warnings) ? normalized.warnings : [],
    lossFlags: Array.isArray(normalized.lossFlags) ? normalized.lossFlags : [],
  });
  await pruneStoredSnapshots(feed.id);
  return sourceSnapshot;
}

async function callSubconverter(target, listMode) {
  const finalUrl = `${CONVERTER_URL}?target=${encodeURIComponent(target)}&url=${encodeURIComponent(
    SOURCE_URL,
  )}&list=${listMode ? "true" : "false"}`;
  const res = await fetch(finalUrl);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`subconverter ${res.status}: ${text.slice(0, 180)}`);
  }
  return text;
}

async function convertViaSubconverter(rawText) {
  if (!CONVERTER_URL) {
    throw new Error("CONVERTER_URL is not set");
  }
  fs.writeFileSync(SOURCE_PATH, rawText);
  const text = await callSubconverter("clash", true);
  fs.writeFileSync(OUT_CONVERTED, text);
  return text;
}

async function convertViaSubconverterToRaw(rawText) {
  if (!CONVERTER_URL) {
    throw new Error("CONVERTER_URL is not set");
  }
  fs.writeFileSync(SOURCE_PATH, rawText);
  try {
    return await callSubconverter("mixed", false);
  } catch {
    return await callSubconverter("mixed", true);
  }
}

function resolveLocalSourcePath(input) {
  const raw = String(input || "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) return "";

  if (raw.startsWith("local:")) {
    const filePath = resolveLocalSourceFilePath(raw.slice(6).trim());
    if (filePath && fs.existsSync(filePath)) return filePath;
    return "";
  }

  let candidate = raw;
  if (raw.startsWith("file://")) {
    try {
      candidate = decodeURIComponent(new URL(raw).pathname);
    } catch {
      return "";
    }
  } else if (raw.startsWith("file:")) {
    candidate = raw.slice(5).trim();
  }

  const possible = [];
  if (path.isAbsolute(candidate)) {
    possible.push(path.resolve(candidate));
  } else {
    possible.push(path.resolve(process.cwd(), candidate));
    possible.push(path.resolve("/data", candidate));
    possible.push(path.resolve("/resources", candidate));
  }

  for (const next of possible) {
    if (!LOCAL_SOURCE_ROOTS.some((root) => next === root || next.startsWith(`${root}${path.sep}`))) continue;
    try {
      if (fs.existsSync(next) && fs.statSync(next).isFile()) return next;
    } catch {
      // ignore unreadable candidate
    }
  }
  return "";
}

function buildRequestUrlFromParams(params) {
  const reqUrl = new URL("http://localhost/sub");
  for (const key of ["sub_url", "output", "app", "device", "profile", "profiles", "hwid"]) {
    const value = params?.[key];
    if (value === undefined || value === null || value === "") continue;
    reqUrl.searchParams.set(key, String(value));
  }
  return reqUrl;
}

async function fetchMergedSource(mergeId) {
  const found = getMergedSource(mergeId);
  if (!found.ok) {
    throw new Error(found.error || "merged source not found");
  }
  const blocks = [];
  for (const item of found.source.items) {
    const reqUrl = buildRequestUrlFromParams(item || {});
    const config = resolveRequestConfig(reqUrl, {});
    if (!config.ok) {
      throw new Error(config.error || "invalid merged source item");
    }
    const fetched = await fetchWithNode(config.subUrl, config.forwardHeaders);
    const produced = await produceOutput(fetched.body, OUTPUT_RAW, { app: config.app });
    if (!produced.ok) {
      throw new Error(produced.error || "failed to convert merged source item");
    }
    const lines = String(produced.body || "").trim();
    if (lines) blocks.push(lines);
  }
  const body = blocks.join("\n");
  return {
    body,
    responseHeaders: {
      "content-type": "text/plain; charset=utf-8",
    },
    responseStatus: 200,
    responseUrl: `merge:${mergeId}`,
  };
}

async function fetchWithNode(subUrl, forwardHeaders) {
  const decrypted = await decryptHappLink(subUrl);
  const raw = String(decrypted.resolvedUrl || subUrl || "").trim();
  if (raw.startsWith("merge:")) {
    return fetchMergedSource(raw.slice(6).trim());
  }
  const localPath = resolveLocalSourcePath(subUrl);
  if (localPath) {
    return {
      body: fs.readFileSync(localPath, "utf8"),
      responseHeaders: {
        "content-type": "text/plain; charset=utf-8",
      },
      responseStatus: 200,
      responseUrl: `file://${localPath}`,
    };
  }
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

async function produceOutput(rawText, output, options = {}) {
  if (!rawText || rawText.trim().length === 0) {
    return { ok: false, error: "empty response" };
  }
  if (isHtml(rawText)) {
    return { ok: false, error: "got HTML (anti-bot page)" };
  }

  if (output === OUTPUT_RAW_BASE64) {
    const rawResult = await produceOutput(rawText, OUTPUT_RAW, options);
    if (!rawResult.ok) return rawResult;
    return {
      ok: true,
      body: Buffer.from(String(rawResult.body || ""), "utf8").toString("base64"),
      contentType: "text/plain; charset=utf-8",
      conversion: rawResult.conversion === "none-raw" ? "base64-raw" : `${rawResult.conversion}+base64-raw`,
    };
  }

  if (output === OUTPUT_JSON) {
    const trimmed = String(rawText || "").trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          ok: true,
          body: JSON.stringify(parsed, null, 2),
          contentType: "application/json; charset=utf-8",
          conversion: "none-json",
        };
      } catch {
        // fall through to raw->json conversion
      }
    }

    const rawResult = await produceOutput(rawText, OUTPUT_RAW, options);
    if (!rawResult.ok) return rawResult;
    const configs = buildJsonConfigBundleFromRaw(String(rawResult.body || ""));
    if (configs.length > 0) {
      return {
        ok: true,
        body: JSON.stringify(configs, null, 2),
        contentType: "application/json; charset=utf-8",
        conversion: rawResult.conversion === "none-raw" ? "raw-json-bundle" : `${rawResult.conversion}+raw-json-bundle`,
      };
    }
    return {
      ok: true,
      body: JSON.stringify(extractSubscriptionLines(rawResult.body), null, 2),
      contentType: "application/json; charset=utf-8",
      conversion: rawResult.conversion === "none-raw" ? "raw-json" : `${rawResult.conversion}+raw-json`,
    };
  }

  if (output === OUTPUT_RAW) {
    let out = extractConvertibleSource(rawText);
    let conversion = "none-raw";

    if (out !== rawText && looksLikeUriListOrBase64(out)) {
      out = decodeBase64IfNeeded(out);
      conversion = "json-fallback-raw";
    }

    if (looksLikeClashProviderYaml(out)) {
      try {
        let converted = await convertViaSubconverterToRaw(out);
        if (looksLikeUriListOrBase64(converted)) {
          converted = decodeBase64IfNeeded(converted);
        }
        if (hasAnySubscriptions(converted) && !looksLikeClashProviderYaml(converted)) {
          out = converted;
          conversion = "subconverter-raw";
        } else {
          const fallback = convertClashYamlToRawUris(out);
          if (hasAnySubscriptions(fallback) && !looksLikeClashProviderYaml(fallback)) {
            out = fallback;
            conversion = "yaml-fallback-raw";
          } else {
            return { ok: false, error: "failed to convert yaml to raw" };
          }
        }
      } catch (e) {
        const fallback = convertClashYamlToRawUris(out);
        if (hasAnySubscriptions(fallback) && !looksLikeClashProviderYaml(fallback)) {
          out = fallback;
          conversion = "yaml-fallback-raw";
        } else {
          return { ok: false, error: `failed to convert yaml to raw: ${e?.message || e}` };
        }
      }
    }

    if (!hasAnySubscriptions(out)) {
      return { ok: false, error: "no subscriptions" };
    }
    return { ok: true, body: out, contentType: "text/plain; charset=utf-8", conversion };
  }

  if (output !== OUTPUT_CLASH) {
    return { ok: false, error: `unsupported output: ${output}` };
  }

  let out = rawText;
  let conversion = "none";
  const appToken = sanitizeProfileToken(options.app);

  if (!looksLikeClashProviderYaml(rawText)) {
    let convertible = extractConvertibleSource(rawText);
    if (looksLikeUriListOrBase64(convertible)) {
      convertible = decodeBase64IfNeeded(convertible);
    }
    try {
      out = await convertViaSubconverter(convertible);
      conversion = "subconverter";
    } catch {
      out = convertible;
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
    return { ok: false, error: "output has no proxies" };
  }
  if (!hasAnySubscriptions(out)) {
    return { ok: false, error: "no subscriptions" };
  }
  if (appToken === "flclashx") {
    const wrapped = wrapClashProviderForFlClash(out);
    if (wrapped !== out) {
      out = wrapped;
      conversion = conversion === "none" ? "flclashx-wrap" : `${conversion}+flclashx-wrap`;
    }
  }
  return { ok: true, body: out, contentType: "text/yaml; charset=utf-8", conversion };
}

async function refreshCache(subUrl, output, profileNames, forwardHeaders, app = "", device = "", req = null) {
  const fetched = await fetchWithNode(subUrl, forwardHeaders);
  await persistSuccessfulSourceSnapshot({
    req,
    route: "/last",
    subUrl,
    output,
    profileNames,
    app,
    device,
    forwardHeaders,
    fetched,
  });
  const produced = await produceOutput(fetched.body, output, { app });
  if (!produced.ok) {
    return produced;
  }
  const upstreamHeaders = sanitizeUpstreamResponseHeaders(fetched.responseHeaders);
  ensureCacheDir();
  const cacheKeyValue = cacheKey(subUrl, output, profileNames.join(","));
  const cachePath = cachePathForKey(cacheKeyValue);
  fs.writeFileSync(`${cachePath}.tmp`, produced.body);
  fs.renameSync(`${cachePath}.tmp`, cachePath);
  writeCacheMeta(cacheKeyValue, { contentType: produced.contentType, responseHeaders: upstreamHeaders });
  return {
    ok: true,
    body: produced.body,
    contentType: produced.contentType,
    responseHeaders: upstreamHeaders,
    conversion: produced.conversion,
  };
}

async function handleSubscription(req, res, forcedProfileName = "") {
  const startedAtMs = Date.now();
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const config = resolveRequestConfig(reqUrl, req.headers, forcedProfileName);
  const output = config.ok ? config.output : OUTPUT_DEFAULT;

  if (!config.ok) {
    res.writeHead(config.status || 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(config.error || "invalid request");
    logRequest({
      route: "/sub",
      status: config.status || 400,
      profiles: forcedProfileName ? [forcedProfileName] : [],
      output,
      durationMs: Date.now() - startedAtMs,
      error: config.error || "invalid request",
    });
    return;
  }

  const { subUrl, profileNames, forwardHeaders, app, device } = config;

  if (!subUrl) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("SUB_URL is required (use ?sub_url= or X-Sub-Url header)");
    logRequest({
      route: "/sub",
      status: 400,
      profiles: profileNames,
      output,
      app,
      device,
      durationMs: Date.now() - startedAtMs,
      error: "missing sub_url",
    });
    return;
  }

  const startedAt = new Date().toISOString();
  try {
    const fetched = await fetchWithNode(subUrl, forwardHeaders);
    await persistSuccessfulSourceSnapshot({
      req,
      route: "/sub",
      subUrl,
      output,
      profileNames,
      app,
      device,
      forwardHeaders,
      fetched,
    });
    const raw = fetched.body;
    const upstreamHeaders = sanitizeUpstreamResponseHeaders(fetched.responseHeaders);

    fs.writeFileSync(OUT_RAW, raw);

    if (!raw || raw.trim().length === 0) {
      writeStatus({
        ok: false,
        startedAt,
        error: "empty response",
        subUrl,
        output,
        profiles: profileNames,
        app,
        device,
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
        output,
        profiles: profileNames,
        app,
        device,
        responseStatus: fetched.responseStatus,
        responseUrl: fetched.responseUrl,
        responseHeaders: fetched.responseHeaders,
        sha1: sha1(raw),
      });
      throw new Error("got HTML (anti-bot page)");
    }

    const produced = await produceOutput(raw, output, { app });
    if (!produced.ok) {
      writeStatus({
        ok: false,
        startedAt,
        error: produced.error,
        subUrl,
        output,
        profiles: profileNames,
        app,
        device,
        responseStatus: fetched.responseStatus,
        responseUrl: fetched.responseUrl,
        responseHeaders: fetched.responseHeaders,
        outputSha1: sha1(raw),
      });
      throw new Error(produced.error);
    }

    const out = produced.body;
    const cacheContentType = produced.contentType;
    const savedPath = cacheContentType.startsWith("text/yaml") ? OUT_YAML : OUT_RAW;
    fs.writeFileSync(`${savedPath}.tmp`, out);
    fs.renameSync(`${savedPath}.tmp`, savedPath);
    ensureCacheDir();
    const cacheKeyValue = cacheKey(subUrl, output, profileNames.join(","));
    const cachePath = cachePathForKey(cacheKeyValue);
    fs.writeFileSync(`${cachePath}.tmp`, out);
    fs.renameSync(`${cachePath}.tmp`, cachePath);
    writeCacheMeta(cacheKeyValue, {
      contentType: cacheContentType,
      responseHeaders: upstreamHeaders,
    });

    writeStatus({
      ok: true,
      startedAt,
      saved: savedPath,
      cached: cachePath,
      sha1: sha1(out),
      bytes: out.length,
      subUrl,
      output,
      profiles: profileNames,
      app,
      device,
      responseStatus: fetched.responseStatus,
      responseUrl: fetched.responseUrl,
      responseHeaders: fetched.responseHeaders,
      forwardedHeaders: forwardHeaders,
      conversion: produced.conversion,
    });

    res.writeHead(200, {
      ...upstreamHeaders,
      "Content-Type": cacheContentType,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(out);
    logRequest({
      route: "/sub",
      status: 200,
      profiles: profileNames,
      output,
      app,
      device,
      contentType: cacheContentType,
      responseStatus: fetched.responseStatus,
      conversion: produced.conversion,
      bytes: out.length,
      durationMs: Date.now() - startedAtMs,
    });
  } catch (e) {
    const fallback = await loadLatestStoredSnapshotBundle({
      subUrl,
      app,
      device,
      profileNames,
      forwardHeaders,
    });
    if (await respondFromStoredSnapshot(res, fallback, output, { app })) {
      logRequest({
        route: "/sub",
        status: 200,
        profiles: profileNames,
        output,
        app,
        device,
        cache: "snapshot-fallback",
        durationMs: Date.now() - startedAtMs,
        error: e?.message || String(e),
      });
      return;
    }
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`failed to fetch subscription: ${e?.message || e}`);
    logRequest({
      route: "/sub",
      status: 502,
      profiles: profileNames,
      output,
      app,
      device,
      durationMs: Date.now() - startedAtMs,
      error: e?.message || String(e),
    });
  }
}

async function handleLast(req, res, forcedProfileName = "") {
  const startedAtMs = Date.now();
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const config = resolveRequestConfig(reqUrl, req.headers, forcedProfileName);
  const output = config.ok ? config.output : OUTPUT_DEFAULT;

  if (!config.ok) {
    res.writeHead(config.status || 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(config.error || "invalid request");
    logRequest({
      route: "/last",
      status: config.status || 400,
      profiles: forcedProfileName ? [forcedProfileName] : [],
      output,
      durationMs: Date.now() - startedAtMs,
      error: config.error || "invalid request",
    });
    return;
  }

  const { subUrl, profileNames, forwardHeaders, app, device } = config;

  if (!subUrl) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("SUB_URL is required (use ?sub_url= or X-Sub-Url header)");
    logRequest({
      route: "/last",
      status: 400,
      profiles: profileNames,
      output,
      app,
      device,
      durationMs: Date.now() - startedAtMs,
      error: "missing sub_url",
    });
    return;
  }

  let refreshed = null;
  try {
    refreshed = await refreshCache(subUrl, output, profileNames, forwardHeaders, app, device, req);
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
      output,
      app,
      device,
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
      output,
      app,
      device,
      cache: "refresh-failed",
      durationMs: Date.now() - startedAtMs,
      error: refreshed.error,
    });
  }

  const key = cacheKey(subUrl, output, profileNames.join(","));
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
        output,
        app,
        device,
        cache: "hit",
        contentType,
        bytes: body.length,
        durationMs: Date.now() - startedAtMs,
      });
    }
  } catch (err) {
    const fallback = await loadLatestStoredSnapshotBundle({
      subUrl,
      app,
      device,
      profileNames,
      forwardHeaders,
    });
    if (await respondFromStoredSnapshot(res, fallback, output, { app })) {
      logRequest({
        route: "/last",
        status: 200,
        profiles: profileNames,
        output,
        app,
        device,
        cache: "snapshot-fallback",
        durationMs: Date.now() - startedAtMs,
        error: err?.message || String(err),
      });
      return;
    }
    if (err && err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("no cached subscription for provided parameters");
      logRequest({
        route: "/last",
        status: 404,
        profiles: profileNames,
        output,
        app,
        device,
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
      output,
      app,
      device,
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

export {
  buildNormalizedModelFromSource,
  detectSourceFormat,
  applyOverridesToNormalized,
  hasMeaningfulOverrides,
  renderClashFromNormalized,
  renderOutputFromNormalized,
  loadLatestStoredSnapshotBundle,
  sourceFormatMatchesOutput,
  isEncryptedHappLink,
  decryptHappLink,
  extractHappDecryptResult,
  parseProfileYaml,
  getUaCatalogOptions,
  readProfileFile,
  profileExists,
  pickUserAgentProfile,
  resolveLocalSourcePath,
  resolveRequestConfig,
  produceOutput,
  persistSuccessfulSourceSnapshot,
  fetchWithNode,
  handleSubscription,
  handleLast,
  handleEcho,
  serveStaticFile,
};
