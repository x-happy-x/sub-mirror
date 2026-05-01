import crypto from "node:crypto";
import {
  createShortLinkRow,
  getShortLinkRow,
  getShortLinkPermissions,
  updateShortLinkRow,
} from "./sqlite-store.js";

const VALID_ENDPOINTS = new Set(["last", "sub"]);
const PARAM_KEYS = ["sub_url", "output", "app", "device", "profile", "profiles", "hwid", "endpoint"];

function sanitizeParams(input) {
  const out = {};
  for (const key of PARAM_KEYS) {
    const value = input?.[key];
    if (value === undefined || value === null) continue;
    const v = String(value).trim();
    if (!v) continue;
    out[key] = v;
  }
  const endpoint = out.endpoint || "last";
  out.endpoint = VALID_ENDPOINTS.has(endpoint) ? endpoint : "last";
  return out;
}

async function generateId() {
  for (let i = 0; i < 20; i += 1) {
    const id = crypto.randomBytes(5).toString("base64url");
    const existing = await getShortLinkRow(id);
    if (!existing) return id;
  }
  return crypto.randomBytes(8).toString("hex");
}

async function createShortLink(params) {
  const sanitized = sanitizeParams(params?.params || params);
  if (!sanitized.sub_url) {
    return { ok: false, status: 400, error: "sub_url is required" };
  }
  const id = await generateId();
  const link = await createShortLinkRow(id, {
    params: sanitized,
    title: params?.title,
    ownerUsername: params?.ownerUsername,
  });
  return { ok: true, link };
}

async function getShortLink(id, actor = null) {
  const token = String(id || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, status: 400, error: "invalid short link id" };
  }
  const permission = await getShortLinkPermissions(token, actor);
  if (!permission?.link) {
    return { ok: false, status: 404, error: "short link not found" };
  }
  if (!permission.canView) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return {
    ok: true,
    link: permission.link,
    permissions: {
      canView: permission.canView,
      canEdit: permission.canEdit,
      canManageAccess: permission.canManageAccess,
      accessLevel: permission.accessLevel || "",
    },
  };
}

async function updateShortLink(id, params, actor = null) {
  const existing = await getShortLink(id, actor);
  if (!existing.ok) return existing;
  if (!existing.permissions?.canEdit) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  const sanitized = sanitizeParams(params?.params || params);
  if (!sanitized.sub_url && !existing.link.params.sub_url) {
    return { ok: false, status: 400, error: "sub_url is required" };
  }

  const token = existing.link.id;
  let current = await updateShortLinkRow(token, sanitized, {
    title: params?.title,
  });
  if (!current) {
    return { ok: false, status: 404, error: "short link not found" };
  }

  current.params.endpoint = VALID_ENDPOINTS.has(current.params.endpoint)
    ? current.params.endpoint
    : "last";
  current = (await updateShortLinkRow(token, { endpoint: current.params.endpoint })) || current;
  return { ok: true, link: current };
}

function buildQueryFromParams(params) {
  const qp = new URLSearchParams();
  const source = sanitizeParams(params || {});
  for (const key of ["sub_url", "output", "app", "device", "profile", "profiles", "hwid"]) {
    if (source[key]) qp.set(key, source[key]);
  }
  return qp;
}

export {
  PARAM_KEYS,
  sanitizeParams,
  createShortLink,
  getShortLink,
  updateShortLink,
  buildQueryFromParams,
};
