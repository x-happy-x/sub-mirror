import type { AuthUser, MockSource, ProfileCatalog, ShortLinkUsersData, SubTestResponse, SubscriptionPayload, UACatalog } from "../types";
import type { FavoriteItem } from "../types";

const PARAM_KEYS = ["sub_url", "endpoint", "output", "app", "device", "profile", "profiles", "hwid"] as const;

export async function fetchAuthState(): Promise<{ enabled: boolean; authenticated: boolean; user: AuthUser | null; publicBaseUrl: string }> {
  const resp = await fetch("/api/auth/me");
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "auth state failed");
  return {
    enabled: Boolean(json.auth?.enabled),
    authenticated: Boolean(json.auth?.authenticated),
    publicBaseUrl: String(json.config?.publicBaseUrl || ""),
    user: json.auth?.user && typeof json.auth.user === "object"
      ? {
          username: String(json.auth.user.username || ""),
          role: String(json.auth.user.role || "user") === "admin" ? "admin" : "user",
        }
      : null,
  };
}

export async function login(username: string, password: string): Promise<void> {
  const resp = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "login failed");
}

export async function logout(): Promise<void> {
  const resp = await fetch("/api/auth/logout", { method: "POST" });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "logout failed");
}

export async function createShortLink(payload: SubscriptionPayload): Promise<{ id: string; shortUrl: string }> {
  const body: Record<string, string> = {};
  for (const key of PARAM_KEYS) {
    const v = payload[key];
    if (v) body[key] = String(v);
  }
  const resp = await fetch("/api/short-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "short-link create failed");
  return { id: json.link.id, shortUrl: json.urls.shortUrl };
}

export async function updateShortLink(id: string, payload: SubscriptionPayload): Promise<void> {
  const body: Record<string, string> = {};
  for (const key of PARAM_KEYS) {
    const v = payload[key];
    if (v) body[key] = String(v);
  }
  const resp = await fetch(`/api/short-links/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "short-link update failed");
}

export async function fetchShortLink(id: string): Promise<SubscriptionPayload> {
  const resp = await fetch(`/api/short-links/${encodeURIComponent(id)}`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "short-link fetch failed");
  return json.link.params as SubscriptionPayload;
}

export async function fetchShortLinkUsers(id: string): Promise<ShortLinkUsersData> {
  const resp = await fetch(`/api/short-links/${encodeURIComponent(id)}/users`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "short-link users fetch failed");
  return json.users as ShortLinkUsersData;
}

export async function updateShortLinkUsersPolicy(
  id: string,
  patch: { maxUsers?: number; blockedMessage?: string; limitMessage?: string },
): Promise<void> {
  const resp = await fetch(`/api/short-links/${encodeURIComponent(id)}/users`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {}),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "short-link users policy update failed");
}

export async function updateShortLinkUserState(
  id: string,
  hwid: string,
  patch: { blocked: boolean; blockReason?: string },
): Promise<void> {
  const resp = await fetch(`/api/short-links/${encodeURIComponent(id)}/users/${encodeURIComponent(hwid)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {}),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "short-link user update failed");
}

export async function deleteShortLinkUserEntry(id: string, hwid: string): Promise<void> {
  const resp = await fetch(`/api/short-links/${encodeURIComponent(id)}/users/${encodeURIComponent(hwid)}`, {
    method: "DELETE",
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "short-link user delete failed");
}

export async function fetchPublicShortLink(id: string): Promise<{ id: string; shortUrl: string; payload: SubscriptionPayload }> {
  const resp = await fetch(`/api/public-short-links/${encodeURIComponent(id)}`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "public short-link fetch failed");
  return {
    id: String(json.link?.id || id),
    shortUrl: String(json.urls?.shortUrl || `${window.location.origin}/l/${encodeURIComponent(id)}`),
    payload: (json.link?.params || {}) as SubscriptionPayload,
  };
}

export type PublicShortMeta = {
  providerName: string;
  userName: string;
  active: boolean;
  statusText: string;
  expiresAt: number | null;
  daysLeft: number | null;
  trafficText: string;
  usedBytes: number;
  totalBytes: number;
  provider: string;
  sourceFormat: string;
  sourceFormatToken: "raw" | "json" | "yml" | "";
  serversCount: number;
  serverEntries: Array<{ name: string; uri: string }>;
  app: string;
  device: string;
  deviceModel: string;
  userAgent: string;
  profiles: string[];
};

export async function fetchPublicShortMeta(id: string): Promise<PublicShortMeta> {
  const resp = await fetch(`/api/public-short-links/${encodeURIComponent(id)}/meta`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "public short-link meta fetch failed");
  const meta = (json.meta || {}) as Record<string, unknown>;
  return {
    providerName: String(meta.providerName || "Подписка"),
    userName: String(meta.userName || id),
    active: Boolean(meta.active),
    statusText: String(meta.statusText || ""),
    expiresAt: typeof meta.expiresAt === "number" ? meta.expiresAt : null,
    daysLeft: typeof meta.daysLeft === "number" ? meta.daysLeft : null,
    trafficText: String(meta.trafficText || ""),
    usedBytes: Number(meta.usedBytes || 0),
    totalBytes: Number(meta.totalBytes || 0),
    provider: String(meta.provider || ""),
    sourceFormat: String(meta.sourceFormat || ""),
    sourceFormatToken: String(meta.sourceFormatToken || "") === "raw"
      ? "raw"
      : (String(meta.sourceFormatToken || "") === "json"
        ? "json"
        : (String(meta.sourceFormatToken || "") === "yml" ? "yml" : "")),
    serversCount: Number(meta.serversCount || 0),
    serverEntries: Array.isArray(meta.serverEntries)
      ? meta.serverEntries
        .map((x) => ({
          name: String((x as Record<string, unknown>)?.name || "").trim(),
          uri: String((x as Record<string, unknown>)?.uri || "").trim(),
        }))
        .filter((x) => Boolean(x.name))
      : [],
    app: String(meta.app || ""),
    device: String(meta.device || ""),
    deviceModel: String(meta.deviceModel || ""),
    userAgent: String(meta.userAgent || ""),
    profiles: Array.isArray(meta.profiles) ? meta.profiles.map((x) => String(x || "")) : [],
  };
}

export async function runSubTest(payload: SubscriptionPayload): Promise<SubTestResponse> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v) params[k] = String(v);
  }
  const resp = await fetch("/api/sub-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params, headers: {} }),
  });
  const json = (await resp.json()) as SubTestResponse;
  if (!resp.ok || !json.ok) throw new Error(json.error || "sub-test failed");
  return json;
}

export async function fetchProfileCatalog(): Promise<ProfileCatalog> {
  const resp = await fetch("/api/profile-editor/list");
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "profile catalog failed");
  return json.catalog as ProfileCatalog;
}

export async function fetchUaCatalog(): Promise<UACatalog> {
  const resp = await fetch("/api/ua-catalog");
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "ua catalog failed");
  return {
    options: (json.options && typeof json.options === "object") ? json.options as Record<string, Record<string, string>> : {},
    defaultUa: typeof json.defaultUa === "string" ? json.defaultUa : "",
  };
}

export type AppsCatalogItem = {
  key: string;
  label: string;
  deeplink: string;
  platforms: string[];
  formats: Array<"raw" | "yml">;
};

export type AppGuide = {
  app: string;
  os: string;
  template: string;
};

export async function fetchAppsCatalog(): Promise<{
  apps: string[];
  shareLinks: Record<string, string>;
  items: AppsCatalogItem[];
  recommendedByOs: Record<string, string[]>;
  orderByOs: Record<string, string[]>;
}> {
  const resp = await fetch("/api/apps");
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "apps catalog failed");
  const apps = Array.isArray(json.apps)
    ? json.apps
    .map((item: unknown) => String(item || "").trim().toLowerCase())
    .filter((item: string, idx: number, arr: string[]) => Boolean(item) && arr.indexOf(item) === idx)
    : [];
  const shareLinks: Record<string, string> = {};
  if (json.shareLinks && typeof json.shareLinks === "object") {
    for (const [key, value] of Object.entries(json.shareLinks as Record<string, unknown>)) {
      const app = String(key || "").trim().toLowerCase();
      const template = String(value || "").trim();
      if (app && template) shareLinks[app] = template;
    }
  }
  const items: AppsCatalogItem[] = Array.isArray(json.items)
    ? json.items.map((raw: unknown) => {
      const row = (raw || {}) as Record<string, unknown>;
      const key = String(row.key || "").trim().toLowerCase();
      const label = String(row.label || key || "").trim();
      const deeplink = String(row.deeplink || "").trim();
      const platforms = Array.isArray(row.platforms)
        ? row.platforms.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
        : [];
      const formats = Array.isArray(row.formats)
        ? row.formats
          .map((x) => String(x || "").trim().toLowerCase())
          .filter((x): x is "raw" | "yml" => x === "raw" || x === "yml")
        : [];
      return { key, label, deeplink, platforms, formats: formats.length > 0 ? formats : ["raw", "yml"] };
    }).filter((item: AppsCatalogItem) => Boolean(item.key) && Boolean(item.deeplink))
    : [];
  const recommendedByOs: Record<string, string[]> = {};
  if (json.recommendedByOs && typeof json.recommendedByOs === "object") {
    for (const [os, raw] of Object.entries(json.recommendedByOs as Record<string, unknown>)) {
      const token = String(os || "").trim().toLowerCase();
      if (!token || !Array.isArray(raw)) continue;
      recommendedByOs[token] = raw
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x, i, arr) => Boolean(x) && arr.indexOf(x) === i);
    }
  }
  const orderByOs: Record<string, string[]> = {};
  if (json.orderByOs && typeof json.orderByOs === "object") {
    for (const [os, raw] of Object.entries(json.orderByOs as Record<string, unknown>)) {
      const token = String(os || "").trim().toLowerCase();
      if (!token || !Array.isArray(raw)) continue;
      orderByOs[token] = raw
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x, i, arr) => Boolean(x) && arr.indexOf(x) === i);
    }
  }
  return { apps, shareLinks, items, recommendedByOs, orderByOs };
}

export async function fetchAppGuide(app: string, os: string): Promise<AppGuide> {
  const resp = await fetch(`/api/apps/guide?app=${encodeURIComponent(app)}&os=${encodeURIComponent(os)}`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "app guide failed");
  const guide = (json.guide || {}) as Record<string, unknown>;
  return {
    app: String(guide.app || app),
    os: String(guide.os || os),
    template: String(guide.template || ""),
  };
}

export async function readProfile(name: string): Promise<string> {
  const resp = await fetch(`/api/profile-editor/file?kind=profiles&name=${encodeURIComponent(name)}`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "profile read failed");
  return String(json.content || "");
}

export async function saveProfile(name: string, content: string): Promise<void> {
  const resp = await fetch("/api/profile-editor/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "profiles", name, content }),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "profile save failed");
}

export async function deleteProfile(name: string): Promise<void> {
  const resp = await fetch(`/api/profile-editor/file?kind=profiles&name=${encodeURIComponent(name)}`, { method: "DELETE" });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "profile delete failed");
}

export async function createMockSource(config: Partial<MockSource["config"]>): Promise<MockSource> {
  const resp = await fetch("/api/mock-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "mock create failed");
  return json.source as MockSource;
}

export async function getMockSource(id: string): Promise<MockSource> {
  const resp = await fetch(`/api/mock-sources/${encodeURIComponent(id)}`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "mock read failed");
  return json.source as MockSource;
}

export async function updateMockSource(id: string, config: Partial<MockSource["config"]>): Promise<MockSource> {
  const resp = await fetch(`/api/mock-sources/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "mock update failed");
  return json.source as MockSource;
}

export async function getMockLogs(id: string): Promise<unknown[]> {
  const resp = await fetch(`/api/mock-sources/${encodeURIComponent(id)}/logs`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "mock logs failed");
  return Array.isArray(json.logs) ? json.logs : [];
}

export async function clearMockLogs(id: string): Promise<void> {
  const resp = await fetch(`/api/mock-sources/${encodeURIComponent(id)}/logs`, { method: "POST" });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "mock clear logs failed");
}

export async function adminListUsers(): Promise<AuthUser[]> {
  const resp = await fetch("/api/admin/users");
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "admin users failed");
  if (!Array.isArray(json.users)) return [];
  return json.users.map((x: unknown) => {
    const row = (x || {}) as Record<string, unknown>;
    return {
      username: String(row.username || ""),
      role: String(row.role || "user") === "admin" ? "admin" : "user",
    } as AuthUser;
  });
}

export async function adminCreateUser(input: { username: string; password: string; role: "user" | "admin" }): Promise<void> {
  const resp = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "admin create user failed");
}

export async function adminUpdateUser(
  username: string,
  input: { password?: string; role?: "user" | "admin" },
): Promise<void> {
  const resp = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "admin update user failed");
}

export async function adminDeleteUser(username: string): Promise<void> {
  const resp = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "admin delete user failed");
}

export async function fetchFavorites(): Promise<FavoriteItem[]> {
  const resp = await fetch("/api/favorites");
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "favorites fetch failed");
  return Array.isArray(json.favorites) ? json.favorites as FavoriteItem[] : [];
}

export async function saveFavorites(list: FavoriteItem[]): Promise<FavoriteItem[]> {
  const resp = await fetch("/api/favorites", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorites: Array.isArray(list) ? list : [] }),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || "favorites save failed");
  return Array.isArray(json.favorites) ? json.favorites as FavoriteItem[] : [];
}
