import path from "node:path";

const SUB_URL_DEFAULT = process.env.SUB_URL || "";
const AUTH_SESSION_TTL_SEC = Number(process.env.AUTH_SESSION_TTL_SEC || String(60 * 60 * 24 * 30));
const LEGACY_USE_CONVERTER_DEFAULT = process.env.USE_CONVERTER === "1";
const OUTPUT_DEFAULT_ENV = (process.env.OUTPUT || "").trim().toLowerCase();
const CONVERTER_URL = process.env.CONVERTER_URL || "";
const SOURCE_URL = process.env.SOURCE_URL || "http://web/source.txt";
const PORT = Number(process.env.PORT || "8787");
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const MAX_SNAPSHOTS_PER_FEED = Math.max(1, Number(process.env.MAX_SNAPSHOTS_PER_FEED || "10") || 10);
const PROFILE_DIR_ENV = process.env.PROFILE_DIR || "";
const PROFILE_FALLBACK_DIR = path.resolve(process.cwd(), "resources/profiles");
const PROFILE_ROOT_DIRS = PROFILE_DIR_ENV
  ? ["/data/profiles", PROFILE_DIR_ENV]
  : ["/data/profiles", PROFILE_FALLBACK_DIR];
const HEADER_POLICY_DEFAULT = "file_only";
const OUTPUT_RAW = "raw";
const OUTPUT_RAW_BASE64 = "raw_base64";
const OUTPUT_JSON = "json";
const OUTPUT_CLASH = "clash";

function normalizeOutput(value) {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  if (s === "yml" || s === "yaml" || s === OUTPUT_CLASH) return OUTPUT_CLASH;
  if (s === "raw_base64" || s === "raw-base64" || s === "base64") return OUTPUT_RAW_BASE64;
  if (s === OUTPUT_JSON) return OUTPUT_JSON;
  if (s === "raw" || s === "plain" || s === "text" || s === "source") return OUTPUT_RAW;
  return null;
}

const OUTPUT_DEFAULT =
  normalizeOutput(OUTPUT_DEFAULT_ENV) ||
  (LEGACY_USE_CONVERTER_DEFAULT ? OUTPUT_CLASH : OUTPUT_RAW);

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

export {
  SUB_URL_DEFAULT,
  AUTH_SESSION_TTL_SEC,
  CONVERTER_URL,
  SOURCE_URL,
  PORT,
  PUBLIC_BASE_URL,
  MAX_SNAPSHOTS_PER_FEED,
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
  STATIC_FILES,
  normalizeOutput,
};
