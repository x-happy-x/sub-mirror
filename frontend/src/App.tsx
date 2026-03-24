import { useEffect, useMemo, useState, type ComponentProps } from "react";
import type { AuthUser, FavoriteItem, MockSource, ProfileCatalog, ShortLinkUsersData, SubscriptionPayload, SubTestResponse, UACatalog } from "./types";
import { readFavorites, writeFavorites } from "./lib/storage";
import {
  clearMockLogs,
  createMockSource,
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminUpdateUser,
  createShortLink,
  deleteProfile,
  fetchProfileCatalog,
  fetchAppsCatalog,
  fetchAppGuide,
  fetchFavorites as fetchFavoritesRemote,
  fetchUaCatalog,
  fetchShortLink,
  fetchPublicShortLink,
  fetchPublicShortMeta,
  getMockLogs,
  getMockSource,
  login,
  logout,
  fetchAuthState,
  fetchShortLinkUsers,
  updateShortLinkUsersPolicy,
  updateShortLinkUserState,
  deleteShortLinkUserEntry,
  readProfile,
  runSubTest,
  saveFavorites as saveFavoritesRemote,
  saveProfile,
  updateMockSource,
  updateShortLink,
  type AppsCatalogItem,
  type PublicShortMeta,
} from "./lib/api";
import { copyToClipboard } from "./lib/clipboard";
import { FlaskIcon, ImportIcon, PlusIcon, ProfileIcon, CopyIcon, SaveIcon, SaveAsIcon, ThemeIcon, DiceIcon, TrashIcon } from "./icons";
import { SubscriptionCard } from "./components/SubscriptionCard";
import { Modal } from "./components/Modal";
import { HeroHeader } from "./components/HeroHeader";
import { UserMenu } from "./components/UserMenu";
import { SharePanel } from "./components/SharePanel";
import { Button, IconButton, NotificationToasts, TextInput, Textarea, Tooltip, type NotificationItem, type NotificationLevel } from "@x-happy-x/ui-kit";
import subLabIcon from "./assets/sub-lab-icon.png";

type TipButtonProps = ComponentProps<typeof Button> & {
  tip: string;
};

type TipIconButtonProps = ComponentProps<typeof IconButton> & {
  tip: string;
};

function TipButton({ tip, ...props }: TipButtonProps) {
  return (
    <Tooltip content={tip}>
      <span className="ui-tip-wrap">
        <Button {...props} />
      </span>
    </Tooltip>
  );
}

function TipIconButton({ tip, ...props }: TipIconButtonProps) {
  return (
    <Tooltip content={tip}>
      <span className="ui-tip-wrap">
        <IconButton {...props} />
      </span>
    </Tooltip>
  );
}

type TipChipButtonProps = ComponentProps<"button"> & {
  tip: string;
};

function TipChipButton({ tip, className, children, ...props }: TipChipButtonProps) {
  return (
    <Tooltip content={tip}>
      <span className="ui-tip-wrap">
        <button type="button" className={className} title={tip} {...props}>
          {children}
        </button>
      </span>
    </Tooltip>
  );
}

function defaultPayload(): SubscriptionPayload {
  return {
    endpoint: "last",
    sub_url: "",
    output: "yml",
    app: "flclashx",
    device: "windows",
    profile: "",
    profiles: "",
    hwid: "",
  };
}

function labelsFromPayload(p: SubscriptionPayload): string[] {
  const labels: string[] = [p.output || "yml"];
  if (p.app) labels.push(p.app);
  if (p.device) labels.push(p.device);
  if (p.profile) labels.push(`profile:${p.profile}`);
  return labels;
}

function parseUrlToPayload(raw: string): { ok: boolean; payload?: SubscriptionPayload; shortId?: string; error?: string } {
  try {
    const u = new URL(raw, window.location.origin);
    const path = u.pathname.replace(/^\/+/, "");
    if (path.startsWith("l/")) return { ok: true, shortId: path.slice(2) };
    return {
      ok: true,
      payload: {
        endpoint: path === "sub" ? "sub" : "last",
        sub_url: u.searchParams.get("sub_url") || "",
        output: (u.searchParams.get("output") || "yml") as SubscriptionPayload["output"],
        app: u.searchParams.get("app") || "",
        device: u.searchParams.get("device") || "",
        profile: u.searchParams.get("profile") || "",
        profiles: u.searchParams.get("profiles") || "",
        hwid: u.searchParams.get("hwid") || "",
      },
    };
  } catch {
    return { ok: false, error: "Некорректная ссылка" };
  }
}

function buildFullUrlWithOrigin(payload: SubscriptionPayload, origin: string): string {
  const endpoint = payload.endpoint === "sub" ? "sub" : "last";
  const params = new URLSearchParams();
  const keys: Array<keyof SubscriptionPayload> = ["sub_url", "output", "app", "device", "profile", "profiles", "hwid"];
  for (const key of keys) {
    const v = payload[key];
    if (v) params.set(key, String(v));
  }
  if (!params.get("output")) params.set("output", "yml");
  return `${origin}/${endpoint}?${params.toString()}`;
}

function normalizePublicBaseUrl(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

type ProfileHeaderRow = {
  id: string;
  key: string;
  value: string;
};

type ProfileFormState = {
  allowHwidOverride: boolean;
  headers: ProfileHeaderRow[];
};

function unquoteYamlValue(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseProfileForm(content: string): ProfileFormState {
  const lines = String(content || "").split(/\r?\n/);
  let allowHwidOverride = true;
  let inHeaders = false;
  const headers: ProfileHeaderRow[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const allowMatch = trimmed.match(/^allow_hwid_override\s*:\s*(true|false)\s*$/i);
    if (allowMatch) {
      allowHwidOverride = String(allowMatch[1] || "").toLowerCase() === "true";
      continue;
    }

    if (/^headers\s*:\s*$/i.test(trimmed)) {
      inHeaders = true;
      continue;
    }

    if (inHeaders) {
      if (!line.startsWith(" ")) {
        inHeaders = false;
        continue;
      }
      const pair = trimmed.match(/^([A-Za-z0-9._-]+)\s*:\s*(.*)$/);
      if (!pair) continue;
      headers.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: String(pair[1] || "").trim(),
        value: unquoteYamlValue(String(pair[2] || "")),
      });
    }
  }

  return { allowHwidOverride, headers };
}

function quoteYamlValue(value: string): string {
  const escaped = String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `"${escaped}"`;
}

function buildProfileFormYaml(state: ProfileFormState): string {
  const lines = [`allow_hwid_override: ${state.allowHwidOverride ? "true" : "false"}`, "headers:"];
  const validHeaders = state.headers
    .map((row) => ({ key: String(row.key || "").trim(), value: String(row.value || "") }))
    .filter((row) => Boolean(row.key));
  if (validHeaders.length === 0) {
    lines.push("  {}");
  } else {
    for (const row of validHeaders) {
      lines.push(`  ${row.key}: ${quoteYamlValue(row.value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  window.crypto.getRandomValues(bytes);
  const value = Array.from(bytes).map((x) => x.toString(16).padStart(2, "0")).join("");
  return value.slice(0, length);
}

function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes).map((x) => String(x % 10)).join("");
}

function generateWindowsUuid(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function generateHwidByOs(os: string): string {
  const token = String(os || "").trim().toLowerCase();
  if (token === "windows") return generateWindowsUuid();
  if (token === "router" || token === "ndms") {
    return `${randomDigits(3)}-${randomDigits(3)}-${randomDigits(3)}-${randomDigits(3)}-${randomDigits(3)}`;
  }
  if (token === "macos" || token === "linux") return randomHex(32);
  if (token === "android" || token === "ios") return randomHex(16);
  return randomHex(16);
}

export default function App() {
  type ModalKind = "import" | "composer" | "tester" | "mock" | "profileEditor" | "share" | "subUsers";
  const [theme, setTheme] = useState<"claude" | "claude-dark">(() => {
    const saved = localStorage.getItem("submirror-theme");
    if (saved === "claude" || saved === "claude-dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "claude-dark" : "claude";
  });
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => readFavorites());
  const [status, setStatus] = useState("");
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);
  const [authResolved, setAuthResolved] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [adminUsers, setAdminUsers] = useState<AuthUser[]>([]);
  const [adminNewUsername, setAdminNewUsername] = useState("");
  const [adminNewPassword, setAdminNewPassword] = useState("");
  const [adminNewRole, setAdminNewRole] = useState<"user" | "admin">("user");
  const [adminEditPassword, setAdminEditPassword] = useState("");
  const [payload, setPayload] = useState<SubscriptionPayload>(defaultPayload());
  const [name, setName] = useState("");
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [importUrl, setImportUrl] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [showTester, setShowTester] = useState(false);
  const [showMock, setShowMock] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showSubUsers, setShowSubUsers] = useState(false);
  const [shareItem, setShareItem] = useState<FavoriteItem | null>(null);
  const [subUsersItem, setSubUsersItem] = useState<FavoriteItem | null>(null);
  const [subUsersData, setSubUsersData] = useState<ShortLinkUsersData | null>(null);
  const [subUsersLoading, setSubUsersLoading] = useState(false);
  const [subUsersMax, setSubUsersMax] = useState("0");
  const [subUsersBlockedMessage, setSubUsersBlockedMessage] = useState("");
  const [subUsersLimitMessage, setSubUsersLimitMessage] = useState("");
  const [subUsersExpandedHwid, setSubUsersExpandedHwid] = useState("");
  const [shareModalMeta, setShareModalMeta] = useState<PublicShortMeta | null>(null);
  const [shareModalMetaLoading, setShareModalMetaLoading] = useState(false);
  const [testResult, setTestResult] = useState<SubTestResponse | null>(null);

  const [profileCatalog, setProfileCatalog] = useState<ProfileCatalog>({ profiles: [] });
  const [uaCatalog, setUaCatalog] = useState<UACatalog>({ options: {}, defaultUa: "" });
  const [appsCatalog, setAppsCatalog] = useState<string[]>([]);
  const [appShareLinks, setAppShareLinks] = useState<Record<string, string>>({});
  const [shareApps, setShareApps] = useState<AppsCatalogItem[]>([]);
  const [recommendedByOs, setRecommendedByOs] = useState<Record<string, string[]>>({});
  const [orderByOs, setOrderByOs] = useState<Record<string, string[]>>({});
  const [publicSharePayload, setPublicSharePayload] = useState<SubscriptionPayload | null>(null);
  const [publicShareMeta, setPublicShareMeta] = useState<PublicShortMeta | null>(null);
  const [publicShareMetaLoading, setPublicShareMetaLoading] = useState(false);
  const [publicShareShortUrl, setPublicShareShortUrl] = useState("");
  const [publicShareError, setPublicShareError] = useState("");
  const [publicShareLoading, setPublicShareLoading] = useState(false);
  const [selectedOs, setSelectedOs] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileContent, setProfileContent] = useState("");
  const [profileForm, setProfileForm] = useState<ProfileFormState>({ allowHwidOverride: true, headers: [] });

  const [mockId, setMockId] = useState("");
  const [mockUrl, setMockUrl] = useState("");
  const [mockPreset, setMockPreset] = useState("stub_raw");
  const [mockStatus, setMockStatus] = useState("200");
  const [mockContentType, setMockContentType] = useState("text/plain; charset=utf-8");
  const [mockDelayMs, setMockDelayMs] = useState("0");
  const [mockHeaders, setMockHeaders] = useState("{}");
  const [mockBody, setMockBody] = useState("");
  const [mockLogs, setMockLogs] = useState("");
  const [mockTestTarget, setMockTestTarget] = useState("__current__");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");

  const notify = (level: NotificationLevel, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item: NotificationItem = { id, level, message, createdAt: Date.now() };
    setNotifications((prev) => [...prev, item].slice(-6));
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((x) => x.id !== id));
    }, 3200);
  };

  useEffect(() => {
    void fetchAuthState()
      .then((auth) => {
        setAuthEnabled(auth.enabled);
        setAuthenticated(auth.authenticated || !auth.enabled);
        setAuthUser(auth.user || null);
        setPublicBaseUrl(normalizePublicBaseUrl(auth.publicBaseUrl));
      })
      .catch(() => {})
      .finally(() => setAuthResolved(true));
  }, []);

  const effectiveOrigin = useMemo(() => {
    const fromApi = normalizePublicBaseUrl(publicBaseUrl);
    return fromApi || window.location.origin;
  }, [publicBaseUrl]);

  useEffect(() => {
    if (!authResolved) return;
    if (authEnabled && !authenticated) return;
    void fetchFavoritesRemote()
      .then(async (remote) => {
        const local = readFavorites();
        if (remote.length === 0 && local.length > 0) {
          try {
            await saveFavoritesRemote(local);
          } catch {
            // Keep local fallback if remote sync is unavailable.
          }
          return local;
        }
        return remote;
      })
      .then((list) => {
        setFavorites(list);
        writeFavorites(list);
      })
      .catch(() => {});
  }, [authResolved, authEnabled, authenticated]);

  useEffect(() => {
    if (!authResolved) return;
    if (authEnabled && !authenticated) return;
    void Promise.all([fetchProfileCatalog(), fetchUaCatalog(), fetchAppsCatalog()])
      .then(([profiles, ua, apps]) => {
        setProfileCatalog(profiles);
        setUaCatalog(ua);
        setAppsCatalog(apps.apps);
        setAppShareLinks(apps.shareLinks);
        setShareApps(apps.items);
        setRecommendedByOs(apps.recommendedByOs);
        setOrderByOs(apps.orderByOs);
      })
      .catch(() => {});
  }, [authResolved, authEnabled, authenticated]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("submirror-theme", theme);
  }, [theme]);

  const isAdminPath = window.location.pathname === "/admin";
  const publicShareMatch = window.location.pathname.match(/^\/l\/([A-Za-z0-9_-]+)$/);
  const publicShareId = publicShareMatch ? publicShareMatch[1] : "";
  const publicTypeOverrideRaw = String(new URLSearchParams(window.location.search).get("type") || "").trim().toLowerCase();
  const publicTypeOverride = publicTypeOverrideRaw === "raw"
    ? "raw"
    : ((publicTypeOverrideRaw === "yml" || publicTypeOverrideRaw === "yaml" || publicTypeOverrideRaw === "clash") ? "yml" : "");
  const isAdminUser = authUser?.role === "admin";
  const isMainPath = !isAdminPath && !publicShareId;
  const isAnyModalOpen = showImport || showComposer || showTester || showMock || showProfileEditor || showShare || showSubUsers;

  const refreshAdminUsers = async () => {
    const list = await adminListUsers();
    setAdminUsers(list);
  };

  useEffect(() => {
    if (!isAdminPath || !authenticated || !isAdminUser) return;
    void refreshAdminUsers().catch(() => {});
  }, [isAdminPath, authenticated, isAdminUser]);

  useEffect(() => {
    if (!publicShareId) return;
    setPublicShareLoading(true);
    setPublicShareError("");
    setPublicShareMeta(null);
    setPublicShareMetaLoading(true);
    void Promise.all([fetchPublicShortLink(publicShareId), fetchAppsCatalog()])
      .then(([shared, apps]) => {
        setPublicSharePayload({ ...defaultPayload(), ...shared.payload });
        setPublicShareShortUrl(shared.shortUrl);
        setAppsCatalog(apps.apps);
        setAppShareLinks(apps.shareLinks);
        setShareApps(apps.items);
        setRecommendedByOs(apps.recommendedByOs);
        setOrderByOs(apps.orderByOs);
      })
      .catch((e) => {
        setPublicShareError((e as Error)?.message || "Не удалось загрузить страницу шаринга");
      })
      .finally(() => setPublicShareLoading(false));

    void fetchPublicShortMeta(publicShareId)
      .then((meta) => setPublicShareMeta(meta))
      .catch(() => {})
      .finally(() => setPublicShareMetaLoading(false));
  }, [publicShareId]);

  useEffect(() => {
    if (!showShare || !shareItem?.shortId) {
      setShareModalMeta(null);
      setShareModalMetaLoading(false);
      return;
    }
    setShareModalMeta(null);
    setShareModalMetaLoading(true);
    void fetchPublicShortMeta(shareItem.shortId)
      .then((meta) => setShareModalMeta(meta))
      .catch(() => {})
      .finally(() => setShareModalMetaLoading(false));
  }, [showShare, shareItem?.shortId]);

  const saveFavorites = (list: FavoriteItem[]) => {
    const next = list.slice(0, 50);
    setFavorites(next);
    writeFavorites(next);
    if (!authResolved) return;
    if (authEnabled && !authenticated) return;
    void saveFavoritesRemote(next).catch(() => {});
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((x) => x.id !== id));
  };

  const closeAllModals = () => {
    setShowImport(false);
    setShowComposer(false);
    setShowTester(false);
    setShowMock(false);
    setShowProfileEditor(false);
    setShowShare(false);
    setShowSubUsers(false);
  };

  const openModal = (kind: ModalKind) => {
    closeAllModals();
    if (kind === "import") setShowImport(true);
    if (kind === "composer") setShowComposer(true);
    if (kind === "tester") setShowTester(true);
    if (kind === "mock") setShowMock(true);
    if (kind === "profileEditor") setShowProfileEditor(true);
    if (kind === "share") setShowShare(true);
    if (kind === "subUsers") setShowSubUsers(true);
  };

  const resetComposer = () => {
    setPayload(defaultPayload());
    setName("");
    setEditingIndex(-1);
  };

  const handleSave = async (forceNew: boolean) => {
    if (!payload.sub_url) return setStatus("Укажите sub_url");
    if (!name.trim()) return setStatus("Укажите название");
    try {
      const next = [...favorites];
      const existing = !forceNew && editingIndex >= 0 ? next[editingIndex] : null;
      let shortId = existing?.shortId || "";
      let shortUrl = existing?.url || "";

      if (shortId && !forceNew) await updateShortLink(shortId, payload);
      else {
        const created = await createShortLink(payload);
        shortId = created.id;
        shortUrl = created.shortUrl;
      }

      const item: FavoriteItem = {
        title: name.trim(),
        url: shortUrl,
        shortId,
        payload: { ...payload },
        labels: labelsFromPayload(payload),
        ts: Date.now(),
      };

      if (!forceNew && editingIndex >= 0) next[editingIndex] = item;
      else next.unshift(item);

      saveFavorites(next);
      setShowComposer(false);
      setStatus(`Сохранено: ${shortUrl}`);
      notify("success", "Подписка сохранена");
    } catch (e) {
      const message = (e as Error)?.message || "Не удалось сохранить подписку";
      setStatus(message);
      notify("error", message);
    }
  };

  const applyImport = async () => {
    const parsed = parseUrlToPayload(importUrl.trim());
    if (!parsed.ok) return setStatus(parsed.error || "Ошибка импорта");
    if (parsed.shortId) {
      const p = await fetchShortLink(parsed.shortId);
      setPayload({ ...defaultPayload(), ...p });
    } else if (parsed.payload) {
      setPayload({ ...defaultPayload(), ...parsed.payload });
    }
    openModal("composer");
    notify("info", "Ссылка импортирована");
  };

  const onEdit = (idx: number) => {
    const item = favorites[idx];
    if (!item) return;
    setEditingIndex(idx);
    setName(item.title);
    setPayload({ ...defaultPayload(), ...item.payload });
    openModal("composer");
  };

  const onDelete = (idx: number) => {
    const next = favorites.filter((_, i) => i !== idx);
    saveFavorites(next);
    notify("info", "Подписка удалена");
  };

  const runTester = async (data = payload) => {
    try {
      const result = await runSubTest(data);
      setTestResult(result);
      notify("success", "Тест завершен");
    } catch (e) {
      const message = (e as Error)?.message || "Ошибка теста";
      notify("error", message);
      throw e;
    }
  };

  const applySavedToTester = async (runNow = false, idxRaw = "0") => {
    const idx = Number(idxRaw || "-1");
    if (!Number.isInteger(idx) || idx < 0 || idx >= favorites.length) return;
    const item = favorites[idx];
    let p = item.payload;
    if ((!p || !p.sub_url) && item.shortId) p = await fetchShortLink(item.shortId);
    setPayload({ ...defaultPayload(), ...p });
    openModal("tester");
    if (runNow) await runTester({ ...defaultPayload(), ...p });
  };

  const sourceServers = useMemo(() => testResult?.upstream?.servers || [], [testResult]);
  const convertedServers = useMemo(() => testResult?.conversion?.servers || [], [testResult]);
  const osOptions = useMemo(() => Object.keys(uaCatalog.options || {}), [uaCatalog]);
  const appOptions = useMemo(() => {
    if (appsCatalog.length > 0) return appsCatalog;
    if (!selectedOs || !uaCatalog.options[selectedOs]) return [];
    return Object.keys(uaCatalog.options[selectedOs] || {});
  }, [appsCatalog, uaCatalog, selectedOs]);
  const uaPreview = useMemo(() => {
    const os = selectedOs || String(payload.device || "");
    const app = String(payload.app || "");
    if (!os || !app) return uaCatalog.defaultUa || "";
    return uaCatalog.options?.[os]?.[app] || uaCatalog.defaultUa || "";
  }, [selectedOs, payload.device, payload.app, uaCatalog]);

  useEffect(() => {
    if (osOptions.length === 0) return;
    const hasPayloadOs = !!payload.device && !!uaCatalog.options[payload.device];
    const nextOs = hasPayloadOs ? String(payload.device) : (selectedOs && uaCatalog.options[selectedOs] ? selectedOs : osOptions[0]);
    if (nextOs !== selectedOs) setSelectedOs(nextOs);

    const nextApps = appsCatalog.length > 0 ? appsCatalog : Object.keys(uaCatalog.options[nextOs] || {});
    setPayload((prev) => {
      const nextDevice = nextOs;
      const nextApp = nextApps.includes(String(prev.app || "")) ? String(prev.app || "") : (nextApps[0] || String(prev.app || ""));
      if (prev.device === nextDevice && String(prev.app || "") === nextApp) return prev;
      return { ...prev, device: nextDevice, app: nextApp };
    });
  }, [appsCatalog, osOptions, selectedOs, payload.device, uaCatalog]);

  const refreshMockLogs = async () => {
    if (!mockId) return;
    const logs = await getMockLogs(mockId);
    setMockLogs(JSON.stringify(logs, null, 2));
  };

  const createMock = async () => {
    const source = await createMockSource({
      preset: mockPreset,
      status: Number(mockStatus || "200"),
      contentType: mockContentType,
      delayMs: Number(mockDelayMs || "0"),
      body: mockBody,
      headers: JSON.parse(mockHeaders || "{}"),
    });
    setMockId(source.id);
    const url = `${effectiveOrigin}/mock/${source.id}`;
    setMockUrl(url);
    setPayload((prev) => ({ ...prev, sub_url: url }));
    await refreshMockLogs();
    notify("success", "Mock-сервер создан");
  };

  const loadMock = async () => {
    const id = mockUrl.replace(/^.*\/mock\//, "").trim();
    if (!id) return;
    const source = await getMockSource(id);
    setMockId(source.id);
    setMockPreset(source.config.preset || "stub_raw");
    setMockStatus(String(source.config.status || 200));
    setMockContentType(String(source.config.contentType || "text/plain; charset=utf-8"));
    setMockDelayMs(String(source.config.delayMs || 0));
    setMockBody(String(source.config.body || ""));
    setMockHeaders(JSON.stringify(source.config.headers || {}, null, 2));
    await refreshMockLogs();
    notify("info", "Mock-конфигурация загружена");
  };

  const updateMock = async () => {
    if (!mockId) return;
    await updateMockSource(mockId, {
      preset: mockPreset,
      status: Number(mockStatus || "200"),
      contentType: mockContentType,
      delayMs: Number(mockDelayMs || "0"),
      body: mockBody,
      headers: JSON.parse(mockHeaders || "{}"),
    });
    notify("success", "Mock-конфигурация обновлена");
  };

  const clearLogs = async () => {
    if (!mockId) return;
    await clearMockLogs(mockId);
    setMockLogs("[]");
    notify("info", "Логи очищены");
  };

  const mockResolvedUrl = String(mockUrl || "").trim() || (mockId ? `${effectiveOrigin}/mock/${mockId}` : "");

  const runMockSubscriptionTest = async () => {
    if (!mockResolvedUrl) {
      notify("warning", "Сначала создайте или загрузите mock-сервер");
      return;
    }
    let basePayload: SubscriptionPayload = { ...payload };
    if (mockTestTarget !== "__current__") {
      const idx = Number(mockTestTarget || "-1");
      if (!Number.isInteger(idx) || idx < 0 || idx >= favorites.length) {
        notify("warning", "Выберите корректную подписку");
        return;
      }
      const item = favorites[idx];
      let p = item?.payload;
      if ((!p || !p.sub_url) && item?.shortId) {
        p = await fetchShortLink(item.shortId);
      }
      basePayload = { ...defaultPayload(), ...(p || {}) };
    }
    const testPayload: SubscriptionPayload = {
      ...defaultPayload(),
      ...basePayload,
      sub_url: mockResolvedUrl,
    };
    setPayload(testPayload);
    await runTester(testPayload);
  };

  const loadProfileFile = async () => {
    if (!profileName) return;
    const content = await readProfile(profileName);
    setProfileContent(content);
    setProfileForm(parseProfileForm(content));
    notify("info", "Профиль загружен");
  };

  const saveProfileFile = async () => {
    if (!profileName.trim()) return;
    const built = buildProfileFormYaml(profileForm);
    setProfileContent(built);
    await saveProfile(profileName.trim(), built);
    const catalog = await fetchProfileCatalog();
    setProfileCatalog(catalog);
    notify("success", "Профиль сохранен");
  };

  const removeProfileFile = async () => {
    if (!profileName.trim()) return;
    await deleteProfile(profileName.trim());
    setProfileContent("");
    setProfileForm({ allowHwidOverride: true, headers: [] });
    const catalog = await fetchProfileCatalog();
    setProfileCatalog(catalog);
    notify("warning", "Профиль удален");
  };

  const openShare = (item: FavoriteItem) => {
    setShareItem(item);
    openModal("share");
  };

  const openSubUsers = async (item: FavoriteItem) => {
    if (!item.shortId) {
      notify("warning", "Для этой подписки нет short id");
      return;
    }
    setSubUsersItem(item);
    setSubUsersData(null);
    setSubUsersLoading(true);
    setSubUsersExpandedHwid("");
    openModal("subUsers");
    try {
      const data = await fetchShortLinkUsers(item.shortId);
      setSubUsersData(data);
      setSubUsersMax(String(data.policy.maxUsers || 0));
      setSubUsersBlockedMessage(String(data.policy.blockedMessage || ""));
      setSubUsersLimitMessage(String(data.policy.limitMessage || ""));
    } catch (e) {
      notify("error", (e as Error)?.message || "Не удалось загрузить пользователей подписки");
    } finally {
      setSubUsersLoading(false);
    }
  };

  const refreshSubUsers = async () => {
    if (!subUsersItem?.shortId) return;
    const data = await fetchShortLinkUsers(subUsersItem.shortId);
    setSubUsersData(data);
    setSubUsersMax(String(data.policy.maxUsers || 0));
    setSubUsersBlockedMessage(String(data.policy.blockedMessage || ""));
    setSubUsersLimitMessage(String(data.policy.limitMessage || ""));
  };

  const saveSubUsersPolicy = async () => {
    if (!subUsersItem?.shortId) return;
    try {
      await updateShortLinkUsersPolicy(subUsersItem.shortId, {
        maxUsers: Number(subUsersMax || "0"),
        blockedMessage: subUsersBlockedMessage,
        limitMessage: subUsersLimitMessage,
      });
      await refreshSubUsers();
      notify("success", "Настройки ограничений сохранены");
    } catch (e) {
      notify("error", (e as Error)?.message || "Не удалось сохранить настройки");
    }
  };

  const toggleSubUserBlocked = async (hwid: string, blocked: boolean, currentReason = "") => {
    if (!subUsersItem?.shortId) return;
    const reason = blocked
      ? (window.prompt("Текст заглушки для блокировки этого пользователя", currentReason || subUsersBlockedMessage || "") || currentReason || "")
      : "";
    try {
      await updateShortLinkUserState(subUsersItem.shortId, hwid, {
        blocked,
        blockReason: reason,
      });
      await refreshSubUsers();
      notify("success", blocked ? "Пользователь заблокирован" : "Пользователь разблокирован");
    } catch (e) {
      notify("error", (e as Error)?.message || "Не удалось обновить состояние пользователя");
    }
  };

  const removeSubUser = async (hwid: string) => {
    if (!subUsersItem?.shortId) return;
    const ok = window.confirm(`Удалить пользователя ${hwid} из списка?`);
    if (!ok) return;
    try {
      await deleteShortLinkUserEntry(subUsersItem.shortId, hwid);
      await refreshSubUsers();
      notify("warning", "Пользователь удален");
    } catch (e) {
      notify("error", (e as Error)?.message || "Не удалось удалить пользователя");
    }
  };

  const buildAppShareLink = (app: string, link: string) => {
    const template = appShareLinks[String(app || "").toLowerCase()];
    if (!template) return "";
    return template
      .split("{encoded_url}")
      .join(encodeURIComponent(link))
      .split("{url}")
      .join(link);
  };

  const tryLogin = async () => {
    try {
      setAuthError("");
      await login(authUsername, authPassword);
      const auth = await fetchAuthState();
      setAuthEnabled(auth.enabled);
      setAuthenticated(auth.authenticated || !auth.enabled);
      setAuthUser(auth.user || null);
      setPublicBaseUrl(normalizePublicBaseUrl(auth.publicBaseUrl));
      if (auth.user?.role === "admin" && window.location.pathname === "/") {
        history.replaceState(null, "", "/admin");
      }
      if (auth.user?.role !== "admin" && window.location.pathname === "/admin") {
        history.replaceState(null, "", "/");
      }
      setAuthUsername("");
      setAuthPassword("");
      notify("success", "Вы вошли в аккаунт");
    } catch (e) {
      setAuthError((e as Error)?.message || "Ошибка входа");
      notify("error", (e as Error)?.message || "Ошибка входа");
    }
  };

  const tryLogout = async () => {
    try {
      await logout();
      notify("info", "Вы вышли из аккаунта");
    } finally {
      setAuthenticated(false);
      setAuthUser(null);
    }
  };

  const createAdminUser = async () => {
    try {
      setStatus("");
      await adminCreateUser({
        username: adminNewUsername.trim().toLowerCase(),
        password: adminNewPassword,
        role: adminNewRole,
      });
      setAdminNewUsername("");
      setAdminNewPassword("");
      await refreshAdminUsers();
      notify("success", "Пользователь создан");
    } catch (e) {
      setStatus((e as Error)?.message || "Не удалось создать пользователя");
      notify("error", (e as Error)?.message || "Не удалось создать пользователя");
    }
  };

  const updateAdminUser = async (username: string, role: "user" | "admin") => {
    try {
      setStatus("");
      await adminUpdateUser(username, {
        role,
        password: adminEditPassword.trim() ? adminEditPassword : undefined,
      });
      setAdminEditPassword("");
      await refreshAdminUsers();
      notify("success", "Пользователь обновлен");
    } catch (e) {
      setStatus((e as Error)?.message || "Не удалось обновить пользователя");
      notify("error", (e as Error)?.message || "Не удалось обновить пользователя");
    }
  };

  const removeAdminUser = async (username: string) => {
    try {
      setStatus("");
      await adminDeleteUser(username);
      await refreshAdminUsers();
      notify("warning", "Пользователь удален");
    } catch (e) {
      setStatus((e as Error)?.message || "Не удалось удалить пользователя");
      notify("error", (e as Error)?.message || "Не удалось удалить пользователя");
    }
  };

  const resetAdminUserPassword = async (username: string, role: "user" | "admin") => {
    const nextPassword = adminEditPassword.trim();
    if (!nextPassword) {
      setStatus("Введите новый пароль в блоке «Пароль для операций»");
      notify("warning", "Укажите пароль для сброса");
      return;
    }
    try {
      setStatus("");
      await adminUpdateUser(username, {
        role,
        password: nextPassword,
      });
      setAdminEditPassword("");
      await refreshAdminUsers();
      notify("success", "Пароль обновлен");
    } catch (e) {
      setStatus((e as Error)?.message || "Не удалось обновить пароль");
      notify("error", (e as Error)?.message || "Не удалось обновить пароль");
    }
  };

  const goAdmin = () => {
    history.replaceState(null, "", "/admin");
    window.location.reload();
  };

  const goMain = () => {
    history.replaceState(null, "", "/");
    window.location.reload();
  };

  const formatDateTime = (value: string) => {
    const ts = Date.parse(String(value || ""));
    if (!Number.isFinite(ts)) return "—";
    return new Date(ts).toLocaleString();
  };

  const topRightControls = (
    <div className="top-right-controls">
      <Tooltip content={theme === "claude" ? "Включить тёмную тему" : "Включить светлую тему"}>
        <span className="ui-tip-wrap">
          <IconButton className="theme-toggle compact" aria-label="Сменить тему" onClick={() => setTheme((prev) => (prev === "claude" ? "claude-dark" : "claude"))}>
            <ThemeIcon className="btn-icon" />
          </IconButton>
        </span>
      </Tooltip>
      {authEnabled && authenticated ? (
        <UserMenu
          user={authUser}
          onLogout={() => { void tryLogout(); }}
          onAdmin={authUser?.role === "admin" ? goAdmin : undefined}
          onHome={isMainPath ? undefined : goMain}
        />
      ) : null}
    </div>
  );

  const mockModalContent = (
    <div className="mock-layout">
      <section className="mock-section">
        <h3 className="editor-heading">1. Подключение mock</h3>
        <label className="composer-label">URL mock-сервера</label>
        <div className="url-row">
          <TextInput placeholder="http://.../mock/<id>" value={mockUrl} onChange={(e) => setMockUrl(e.target.value)} />
          <TipButton tip="Загрузить конфигурацию mock по URL" className="btn" onClick={() => void loadMock()}>Загрузить</TipButton>
        </div>
        <div className="status">Текущий URL: {mockResolvedUrl || "не задан"}</div>
      </section>

      <section className="mock-section">
        <h3 className="editor-heading">2. Конфигурация ответа</h3>
        <div className="row">
          <select value={mockPreset} onChange={(e) => setMockPreset(e.target.value)}>
            <option value="stub_raw">stub_raw</option>
            <option value="stub_clash">stub_clash</option>
            <option value="no_subscriptions">no_subscriptions</option>
            <option value="antibot_html">antibot_html</option>
          </select>
          <TextInput placeholder="status" value={mockStatus} onChange={(e) => setMockStatus(e.target.value)} />
        </div>
        <div className="row">
          <TextInput placeholder="content-type" value={mockContentType} onChange={(e) => setMockContentType(e.target.value)} />
          <TextInput placeholder="delay ms" value={mockDelayMs} onChange={(e) => setMockDelayMs(e.target.value)} />
        </div>
        <label className="composer-label">headers (JSON)</label>
        <Textarea placeholder='{"x-debug":"demo"}' value={mockHeaders} onChange={(e) => setMockHeaders(e.target.value)} />
        <label className="composer-label">body</label>
        <Textarea placeholder="Тело ответа mock-сервера" value={mockBody} onChange={(e) => setMockBody(e.target.value)} />
        <div className="toolbar">
          <TipButton tip="Создать новый mock-сервер" className="btn" onClick={() => void createMock()}>Создать</TipButton>
          <TipButton tip="Обновить текущий mock-сервер" className="btn" onClick={() => void updateMock()}>Обновить</TipButton>
          <TipButton tip="Показать логи запросов mock-сервера" className="btn" onClick={() => void refreshMockLogs()}>Логи</TipButton>
          <TipButton tip="Очистить логи mock-сервера" className="btn" onClick={() => void clearLogs()}>Очистить логи</TipButton>
          <TipButton tip="Подставить mock URL в sub_url" tone="primary" className="btn" onClick={() => setPayload((p) => ({ ...p, sub_url: mockResolvedUrl }))}>Использовать в конструкторе</TipButton>
        </div>
      </section>

      <section className="mock-section">
        <h3 className="editor-heading">3. Тест подписки через mock</h3>
        <label className="composer-label">Выберите подписку для теста</label>
        <div className="row">
          <select value={mockTestTarget} onChange={(e) => setMockTestTarget(e.target.value)}>
            <option value="__current__">Текущая форма (конструктор)</option>
            {favorites.map((item, idx) => (
              <option key={`${item.shortId || item.title}-${idx}`} value={String(idx)}>
                {item.title} [{item.payload.output || "yml"} | {item.payload.app || "-"} | {item.payload.device || "-"}]
              </option>
            ))}
          </select>
          <TipButton tip="Запустить тест выбранной подписки через mock-сервер" tone="primary" className="btn" onClick={() => void runMockSubscriptionTest()}>
            Тест через mock
          </TipButton>
        </div>
        <div className="toolbar">
          <TipButton tip="Открыть полный тестер" className="btn" onClick={() => setShowTester(true)}>Открыть тестер</TipButton>
          <TipIconButton tip="Копировать исходный ответ" aria-label="Копировать исходный ответ" icon={<CopyIcon className="btn-icon" />} onClick={() => void copyToClipboard(testResult?.upstream?.body || "")} />
          <TipIconButton tip="Копировать результат конвертации" aria-label="Копировать результат конвертации" icon={<CopyIcon className="btn-icon" />} onClick={() => void copyToClipboard(testResult?.conversion?.body || "")} />
        </div>
        <div className="result-grid">
          <div className="result">
            <strong>Источник: {testResult?.upstream?.sourceFormat || "-"}</strong>
            <select>{sourceServers.map((x, i) => <option key={`${x}-${i}`}>{x}</option>)}</select>
          </div>
          <div className="result">
            <strong>После конвертации: {testResult?.conversion?.outputFormat || "-"}</strong>
            <select>{convertedServers.map((x, i) => <option key={`${x}-${i}`}>{x}</option>)}</select>
          </div>
        </div>
      </section>

      <section className="mock-section">
        <h3 className="editor-heading">Логи mock-сервера</h3>
        <pre className="json">{mockLogs || "Логов пока нет"}</pre>
      </section>
    </div>
  );

  if (publicShareId) {
    const publicFullUrl = publicSharePayload ? buildFullUrlWithOrigin(publicSharePayload, effectiveOrigin) : "";
    return (
      <main className="page">
        {isAnyModalOpen ? null : topRightControls}
        <HeroHeader
          logoSrc={subLabIcon}
          subtitle="Подключение подписки"
        />
        {publicShareLoading ? <div className="status">Загрузка...</div> : null}
        {publicShareError ? <div className="status">{publicShareError}</div> : null}
        {publicSharePayload && !publicShareError ? (
          <SharePanel
            shortUrl={publicShareShortUrl}
            fullUrl={publicFullUrl}
            shareApps={shareApps}
            recommendedByOs={recommendedByOs}
            orderByOs={orderByOs}
            topMeta={publicShareMeta}
            topMetaLoading={publicShareMetaLoading}
            subscriptionFormat={publicTypeOverride || publicShareMeta?.sourceFormatToken || publicSharePayload.output || ""}
            preferredOs={publicSharePayload.device || ""}
            preferredApp={publicSharePayload.app || ""}
            buildAppShareLink={buildAppShareLink}
            fetchGuide={fetchAppGuide}
            onCopy={(text) => { void copyToClipboard(text); }}
          />
        ) : null}
      </main>
    );
  }

  if (!authResolved) {
    return (
      <main className="page">
        {isAnyModalOpen ? null : topRightControls}
        <HeroHeader
          logoSrc={subLabIcon}
          subtitle="Проверка доступа"
        />
        <section className="auth-layout">
          <article className="sub-card auth-card">
            <h2>Проверка авторизации...</h2>
            <p>Секунду, загружаем данные сессии.</p>
          </article>
        </section>
        <NotificationToasts items={notifications} onDismiss={dismissNotification} />
      </main>
    );
  }

  if (authEnabled && !authenticated) {
    return (
      <main className="page">
        {isAnyModalOpen ? null : topRightControls}
        <HeroHeader
          logoSrc={subLabIcon}
          subtitle="Авторизация"
        />
        <section className="auth-layout">
          <article className="sub-card auth-card">
            <h2>Вход в SubLab</h2>
            <p>Введите логин и пароль, чтобы открыть подписки и инструменты.</p>
            <div className="auth-fields">
              <TextInput
                type="text"
                placeholder="Логин"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
              />
              <TextInput
                type="password"
                placeholder="Пароль"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>
            <div className="toolbar auth-toolbar">
              <TipButton tip="Войти" tone="primary" className="btn" onClick={() => void tryLogin()}>
                Войти
              </TipButton>
            </div>
            <div className="status auth-status">{authError || " "}</div>
          </article>
        </section>
        <NotificationToasts items={notifications} onDismiss={dismissNotification} />
      </main>
    );
  }

  if (isAdminPath) {
    if (!isAdminUser) {
      return (
        <main className="page">
          {isAnyModalOpen ? null : topRightControls}
          <section className="auth-screen">
            <h1>/admin</h1>
            <p>Доступ только для admin</p>
            <div className="toolbar">
              <TipButton tip="На главную" className="btn" onClick={goMain}>
                На главную
              </TipButton>
            </div>
          </section>
          <NotificationToasts items={notifications} onDismiss={dismissNotification} />
        </main>
      );
    }

    return (
      <main className="page">
        {isAnyModalOpen ? null : topRightControls}
        <header className="hero admin-hero">
          <div>
            <h1>Админка</h1>
            <p>Управление пользователями и сервисными инструментами</p>
          </div>
        </header>

        <section className="admin-overview">
          <article className="sub-card admin-metric-card">
            <div className="admin-metric-label">Пользователи</div>
            <div className="admin-metric-value">{adminUsers.length}</div>
          </article>
          <article className="sub-card admin-metric-card">
            <div className="admin-metric-label">Администраторы</div>
            <div className="admin-metric-value">{adminUsers.filter((u) => u.role === "admin").length}</div>
          </article>
          <article className="sub-card admin-metric-card">
            <div className="admin-metric-label">Обычные пользователи</div>
            <div className="admin-metric-value">{adminUsers.filter((u) => u.role === "user").length}</div>
          </article>
        </section>

        <section className="admin-section">
          <div className="admin-section-head">
            <h2>Инструменты</h2>
            <p>Сервисные экраны для диагностики и настройки профилей.</p>
          </div>
          <div className="admin-tools-grid">
            <button type="button" className="admin-tool-card" onClick={() => openModal("mock")}>
              <span className="admin-tool-icon"><FlaskIcon className="btn-icon" /></span>
              <span className="admin-tool-title">Тестовый сервер</span>
              <span className="admin-tool-text">Проверка источников, пресеты, логирование и отладка ответа.</span>
            </button>
            <button type="button" className="admin-tool-card" onClick={() => openModal("profileEditor")}>
              <span className="admin-tool-icon"><ProfileIcon className="btn-icon" /></span>
              <span className="admin-tool-title">Профили и UA</span>
              <span className="admin-tool-text">Редактирование заголовков профилей и UA-каталога.</span>
            </button>
          </div>
        </section>

        <section className="admin-panel-grid">
          <section className="sub-card admin-form">
            <h2>Создать пользователя</h2>
            <div className="row">
              <TextInput placeholder="username" value={adminNewUsername} onChange={(e) => setAdminNewUsername(e.target.value)} />
              <TextInput type="password" placeholder="password" value={adminNewPassword} onChange={(e) => setAdminNewPassword(e.target.value)} />
              <select value={adminNewRole} onChange={(e) => setAdminNewRole((e.target.value === "admin" ? "admin" : "user"))}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <TipButton tip="Создать пользователя" tone="primary" className="btn" onClick={() => void createAdminUser()}>Создать</TipButton>
            </div>
          </section>

          <section className="sub-card admin-form">
            <h2>Пароль для операций</h2>
            <p className="status">Используется кнопкой «Сбросить пароль». После успешной операции поле очищается.</p>
            <TextInput
              type="password"
              placeholder="Новый пароль"
              value={adminEditPassword}
              onChange={(e) => setAdminEditPassword(e.target.value)}
            />
          </section>
        </section>

        <div className="status admin-status">{status}</div>

        <section className="cards admin-users-list">
          <div className="admin-section-head">
            <h2>Пользователи</h2>
            <p>Смена роли, сброс пароля и удаление аккаунтов.</p>
          </div>
          {adminUsers.map((u) => (
            <article key={u.username} className="sub-card admin-user-card">
              <div className="sub-head admin-user-head">
                <div>
                  <div className="sub-name">{u.username}</div>
                  <div className="labels">
                    <span className="label">{u.role}</span>
                    {u.username === authUser?.username ? <span className="label">текущий аккаунт</span> : null}
                  </div>
                </div>
              </div>
              <div className="admin-user-actions-grid">
                <section className="admin-action-group">
                  <div className="admin-action-title">Роль</div>
                  <div className="toolbar">
                    <TipButton
                      tip={u.username === authUser?.username ? "Нельзя менять роль текущего пользователя" : "Сделать user"}
                      className="btn"
                      disabled={u.username === authUser?.username}
                      onClick={() => void updateAdminUser(u.username, "user")}
                    >
                      Сделать user
                    </TipButton>
                    <TipButton
                      tip={u.username === authUser?.username ? "Нельзя менять роль текущего пользователя" : "Сделать admin"}
                      className="btn"
                      disabled={u.username === authUser?.username}
                      onClick={() => void updateAdminUser(u.username, "admin")}
                    >
                      Сделать admin
                    </TipButton>
                  </div>
                </section>
                <section className="admin-action-group">
                  <div className="admin-action-title">Операции</div>
                  <div className="toolbar">
                    <TipButton tip="Сбросить пароль пользователя" className="btn" onClick={() => void resetAdminUserPassword(u.username, u.role)}>
                      Сбросить пароль
                    </TipButton>
                    <TipButton tip="Удалить пользователя" className="btn" onClick={() => void removeAdminUser(u.username)}>Удалить</TipButton>
                  </div>
                </section>
              </div>
            </article>
          ))}
          {adminUsers.length === 0 ? <article className="sub-card">Пользователи не найдены</article> : null}
        </section>

        {showMock ? (
          <Modal onClose={() => setShowMock(false)} title="Тестовый сервер" showCloseButton>
            {mockModalContent}
          </Modal>
        ) : null}

        {showProfileEditor ? (
          <Modal onClose={() => setShowProfileEditor(false)} title="Редактор профилей и UA" showCloseButton>
            <div className="editor-layout">
              <section className="editor-pane">
                <h3 className="editor-heading">Профили</h3>
                <div className="row">
                  <select value={profileName} onChange={(e) => setProfileName(e.target.value)}>
                    <option value="">Выберите профиль</option>
                    {profileCatalog.profiles.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <TextInput placeholder="или имя нового профиля" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                </div>
                <div className="profile-form-card">
                  <label className="composer-label">Переопределение HWID</label>
                  <div className="chip-row">
                    <TipChipButton
                      tip="Разрешить override hwid из запроса"
                      className={`chip-btn ${profileForm.allowHwidOverride ? "active" : ""}`}
                      onClick={() => setProfileForm((prev) => ({ ...prev, allowHwidOverride: true }))}
                    >
                      Разрешено
                    </TipChipButton>
                    <TipChipButton
                      tip="Запретить override hwid из заголовков запроса"
                      className={`chip-btn ${!profileForm.allowHwidOverride ? "active" : ""}`}
                      onClick={() => setProfileForm((prev) => ({ ...prev, allowHwidOverride: false }))}
                    >
                      Запрещено
                    </TipChipButton>
                  </div>

                  <label className="composer-label">Заголовки профиля</label>
                  <div className="profile-headers-list">
                    {profileForm.headers.length === 0 ? <div className="status">Заголовки не добавлены</div> : null}
                    {profileForm.headers.map((row) => (
                      <div key={row.id} className="profile-header-row">
                        <TextInput
                          placeholder="header-name"
                          value={row.key}
                          onChange={(e) => setProfileForm((prev) => ({
                            ...prev,
                            headers: prev.headers.map((item) => (item.id === row.id ? { ...item, key: e.target.value } : item)),
                          }))}
                        />
                        <TextInput
                          placeholder="value"
                          value={row.value}
                          onChange={(e) => setProfileForm((prev) => ({
                            ...prev,
                            headers: prev.headers.map((item) => (item.id === row.id ? { ...item, value: e.target.value } : item)),
                          }))}
                        />
                        <TipIconButton
                          tip="Удалить заголовок"
                          aria-label="Удалить заголовок"
                          icon={<TrashIcon className="btn-icon" />}
                          onClick={() => setProfileForm((prev) => ({ ...prev, headers: prev.headers.filter((item) => item.id !== row.id) }))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="toolbar">
                    <TipButton
                      tip="Добавить заголовок"
                      className="btn"
                      onClick={() => setProfileForm((prev) => ({
                        ...prev,
                        headers: [...prev.headers, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, key: "", value: "" }],
                      }))}
                    >
                      <PlusIcon className="btn-icon" /> Добавить заголовок
                    </TipButton>
                  </div>
                </div>
                <div className="toolbar">
                  <TipButton tip="Загрузить выбранный профиль" className="btn" onClick={() => void loadProfileFile()}>Загрузить</TipButton>
                  <TipButton tip="Сохранить профиль" className="btn" onClick={() => void saveProfileFile()}>Сохранить</TipButton>
                  <TipButton tip="Удалить профиль" className="btn" onClick={() => void removeProfileFile()}>Удалить</TipButton>
                </div>
              </section>

              <section className="editor-pane">
                <h3 className="editor-heading">UA Каталог</h3>
                <div className="row">
                  <select value={selectedOs} onChange={(e) => setSelectedOs(e.target.value)}>
                    <option value="">Выберите ОС</option>
                    {osOptions.map((osName) => <option key={osName} value={osName}>{osName}</option>)}
                  </select>
                  <select value={payload.app || ""} onChange={(e) => setPayload((p) => ({ ...p, app: e.target.value }))}>
                    <option value="">Выберите приложение</option>
                    {appOptions.map((appName) => <option key={appName} value={appName}>{appName}</option>)}
                  </select>
                </div>
                <label className="composer-label">Текущий User-Agent</label>
                <Textarea readOnly value={uaPreview || "UA не найден"} />
                <div className="status">UA берётся из каталога и автоматически применяется при запросах.</div>
              </section>
            </div>
          </Modal>
        ) : null}
        <NotificationToasts items={notifications} onDismiss={dismissNotification} />
      </main>
    );
  }

  return (
    <main className="page">
      {isAnyModalOpen ? null : topRightControls}
      <HeroHeader
        logoSrc={subLabIcon}
        subtitle="Лаборатория подписок"
      />

      <section className="top-actions">
        <TipButton tip="Импортировать подписку" className="btn" onClick={() => openModal("import")}>
          <ImportIcon className="btn-icon" /> Импорт
        </TipButton>
        <TipButton tip="Добавить новую подписку" tone="primary" className="btn" onClick={() => { resetComposer(); openModal("composer"); }}>
          <PlusIcon className="btn-icon" /> Добавить
        </TipButton>
      </section>

      <section className="cards">
        {favorites.length === 0 ? (
          <article className="sub-card">Еще не добавлена ни одна подписка.</article>
        ) : (
          favorites.map((item, idx) => (
            <SubscriptionCard
              key={`${item.title}-${item.ts}`}
              item={item}
              onEdit={() => onEdit(idx)}
              onDelete={() => onDelete(idx)}
              onTest={() => void applySavedToTester(true, String(idx))}
              onShare={() => openShare(item)}
              onOpenUsers={() => void openSubUsers(item)}
            />
          ))
        )}
      </section>

      {showImport ? (
        <Modal onClose={() => setShowImport(false)} title="Импорт" showCloseButton>
          <TextInput placeholder="Вставьте /sub /last /l/..." value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
          <div className="toolbar"><TipButton tip="Применить импортированную ссылку" tone="primary" className="btn" onClick={() => void applyImport()}>Применить</TipButton></div>
        </Modal>
      ) : null}

      {showComposer ? (
        <Modal onClose={() => setShowComposer(false)} title="Конструктор подписки" showCloseButton>
          <label className="composer-label">Название</label>
          <TextInput placeholder="Название подписки" value={name} onChange={(e) => setName(e.target.value)} />

          <label className="composer-label">URL источника</label>
          <div className="url-row">
            <TextInput placeholder="URL источника (sub_url)" value={payload.sub_url} onChange={(e) => setPayload({ ...payload, sub_url: e.target.value })} />
            <TipChipButton
              tip="Переключить режим выдачи"
              className="chip-btn chip-toggle"
              onClick={() => setPayload({ ...payload, endpoint: payload.endpoint === "last" ? "sub" : "last" })}
            >
              {payload.endpoint === "last" ? "С кэшем" : "Без кэша"}
            </TipChipButton>
          </div>

          <label className="composer-label">Формат</label>
          <div className="chip-row">
            <TipChipButton tip="Формат YAML" className={`chip-btn ${payload.output === "yml" ? "active" : ""}`} onClick={() => setPayload({ ...payload, output: "yml" })}>yml</TipChipButton>
            <TipChipButton tip="Формат RAW" className={`chip-btn ${payload.output === "raw" ? "active" : ""}`} onClick={() => setPayload({ ...payload, output: "raw" })}>raw</TipChipButton>
            <TipChipButton tip="Формат RAW в base64" className={`chip-btn ${payload.output === "raw_base64" ? "active" : ""}`} onClick={() => setPayload({ ...payload, output: "raw_base64" })}>raw (base64)</TipChipButton>
            <TipChipButton tip="Формат JSON" className={`chip-btn ${payload.output === "json" ? "active" : ""}`} onClick={() => setPayload({ ...payload, output: "json" })}>json</TipChipButton>
          </div>

          <label className="composer-label">ОС</label>
          <div className="chip-row">
            {osOptions.length === 0 ? <span className="status">UA-каталог пуст</span> : null}
            {osOptions.map((osName) => (
              <TipChipButton
                tip={`ОС: ${osName}`}
                key={osName}
                className={`chip-btn ${selectedOs === osName ? "active" : ""}`}
                onClick={() => {
                  const apps = appsCatalog.length > 0 ? appsCatalog : Object.keys(uaCatalog.options[osName] || {});
                  setSelectedOs(osName);
                  setPayload((prev) => ({
                    ...prev,
                    device: osName,
                    app: apps.includes(String(prev.app || "")) ? String(prev.app || "") : (apps[0] || String(prev.app || "")),
                  }));
                }}
              >
                {osName}
              </TipChipButton>
            ))}
          </div>

          <label className="composer-label">Приложение</label>
          <div className="chip-row">
            {appOptions.map((appName) => (
              <TipChipButton
                tip={`Приложение: ${appName}`}
                key={appName}
                className={`chip-btn ${payload.app === appName ? "active" : ""}`}
                onClick={() => setPayload({ ...payload, app: appName })}
              >
                {appName}
              </TipChipButton>
            ))}
          </div>

          <label className="composer-label">Предустановки</label>
          <div className="chip-row">
            <TipChipButton tip="Без предустановки" className={`chip-btn ${!payload.profile ? "active" : ""}`} onClick={() => setPayload({ ...payload, profile: "" })}>Без профиля</TipChipButton>
            {profileCatalog.profiles.map((profileName) => (
              <TipChipButton tip={`Предустановка: ${profileName}`} key={profileName} className={`chip-btn ${payload.profile === profileName ? "active" : ""}`} onClick={() => setPayload({ ...payload, profile: profileName })}>
                {profileName}
              </TipChipButton>
            ))}
          </div>

          <label className="composer-label">HWID</label>
          <div className="hwid-row">
            <TextInput placeholder="hwid" value={payload.hwid || ""} onChange={(e) => setPayload({ ...payload, hwid: e.target.value })} />
            <TipIconButton
              tip="Сгенерировать случайный HWID"
              aria-label="Сгенерировать HWID"
              icon={<DiceIcon className="btn-icon" />}
              onClick={() => setPayload((prev) => ({ ...prev, hwid: generateHwidByOs(selectedOs || prev.device || "") }))}
            />
          </div>
          <div className="toolbar">
            <TipIconButton tip="Сохранить" aria-label="Сохранить" icon={<SaveIcon className="btn-icon" />} onClick={() => void handleSave(false)} />
            <TipIconButton tip="Сохранить как" aria-label="Сохранить как" icon={<SaveAsIcon className="btn-icon" />} onClick={() => void handleSave(true)} />
            <TipIconButton tip="Открыть тестер" aria-label="Открыть тестер" icon={<FlaskIcon className="btn-icon" />} onClick={() => openModal("tester")} />
          </div>
          <div className="status">{status}</div>
        </Modal>
      ) : null}

      {showTester ? (
        <Modal onClose={() => setShowTester(false)} title="Тестер подписки" showCloseButton>
          <div className="toolbar"><TipButton tip="Запустить тест подписки" tone="primary" className="btn" onClick={() => void runTester()}>Запустить тест</TipButton></div>
          <div className="result-grid">
            <div className="result">
              <strong>Источник: {testResult?.upstream?.sourceFormat || "-"}</strong>
              <select>{sourceServers.map((x, i) => <option key={`${x}-${i}`}>{x}</option>)}</select>
              <TipIconButton tip="Копировать исходный ответ" icon={<CopyIcon className="btn-icon" />} onClick={() => void copyToClipboard(testResult?.upstream?.body || "")} />
            </div>
            <div className="result">
              <strong>После конвертации: {testResult?.conversion?.outputFormat || "-"}</strong>
              <select>{convertedServers.map((x, i) => <option key={`${x}-${i}`}>{x}</option>)}</select>
              <TipIconButton tip="Копировать результат конвертации" icon={<CopyIcon className="btn-icon" />} onClick={() => void copyToClipboard(testResult?.conversion?.body || "")} />
            </div>
          </div>
          <pre className="json">{JSON.stringify(testResult, null, 2)}</pre>
        </Modal>
      ) : null}

      {showMock ? (
        <Modal onClose={() => setShowMock(false)} title="Тестовый сервер" showCloseButton>
          {mockModalContent}
        </Modal>
      ) : null}

      {showProfileEditor ? (
        <Modal onClose={() => setShowProfileEditor(false)} title="Редактор профилей и UA" showCloseButton>
          <div className="editor-layout">
            <section className="editor-pane">
              <h3 className="editor-heading">Профили</h3>
              <div className="row">
                <select value={profileName} onChange={(e) => setProfileName(e.target.value)}>
                  <option value="">Выберите профиль</option>
                  {profileCatalog.profiles.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                <TextInput placeholder="или имя нового профиля" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
              </div>
              <div className="profile-form-card">
                <label className="composer-label">Переопределение HWID</label>
                <div className="chip-row">
                  <TipChipButton
                    tip="Разрешить override hwid из запроса"
                    className={`chip-btn ${profileForm.allowHwidOverride ? "active" : ""}`}
                    onClick={() => setProfileForm((prev) => ({ ...prev, allowHwidOverride: true }))}
                  >
                    Разрешено
                  </TipChipButton>
                  <TipChipButton
                    tip="Запретить override hwid из заголовков запроса"
                    className={`chip-btn ${!profileForm.allowHwidOverride ? "active" : ""}`}
                    onClick={() => setProfileForm((prev) => ({ ...prev, allowHwidOverride: false }))}
                  >
                    Запрещено
                  </TipChipButton>
                </div>

                <label className="composer-label">Заголовки профиля</label>
                <div className="profile-headers-list">
                  {profileForm.headers.length === 0 ? <div className="status">Заголовки не добавлены</div> : null}
                  {profileForm.headers.map((row) => (
                    <div key={row.id} className="profile-header-row">
                      <TextInput
                        placeholder="header-name"
                        value={row.key}
                        onChange={(e) => setProfileForm((prev) => ({
                          ...prev,
                          headers: prev.headers.map((item) => (item.id === row.id ? { ...item, key: e.target.value } : item)),
                        }))}
                      />
                      <TextInput
                        placeholder="value"
                        value={row.value}
                        onChange={(e) => setProfileForm((prev) => ({
                          ...prev,
                          headers: prev.headers.map((item) => (item.id === row.id ? { ...item, value: e.target.value } : item)),
                        }))}
                      />
                      <TipIconButton
                        tip="Удалить заголовок"
                        aria-label="Удалить заголовок"
                        icon={<TrashIcon className="btn-icon" />}
                        onClick={() => setProfileForm((prev) => ({ ...prev, headers: prev.headers.filter((item) => item.id !== row.id) }))}
                      />
                    </div>
                  ))}
                </div>
                <div className="toolbar">
                  <TipButton
                    tip="Добавить заголовок"
                    className="btn"
                    onClick={() => setProfileForm((prev) => ({
                      ...prev,
                      headers: [...prev.headers, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, key: "", value: "" }],
                    }))}
                  >
                    <PlusIcon className="btn-icon" /> Добавить заголовок
                  </TipButton>
                </div>
              </div>
              <div className="toolbar">
                <TipButton tip="Загрузить выбранный профиль" className="btn" onClick={() => void loadProfileFile()}>Загрузить</TipButton>
                <TipButton tip="Сохранить профиль" className="btn" onClick={() => void saveProfileFile()}>Сохранить</TipButton>
                <TipButton tip="Удалить профиль" className="btn" onClick={() => void removeProfileFile()}>Удалить</TipButton>
              </div>
            </section>

            <section className="editor-pane">
              <h3 className="editor-heading">UA Каталог</h3>
              <div className="row">
                <select value={selectedOs} onChange={(e) => setSelectedOs(e.target.value)}>
                  <option value="">Выберите ОС</option>
                  {osOptions.map((osName) => <option key={osName} value={osName}>{osName}</option>)}
                </select>
                <select value={payload.app || ""} onChange={(e) => setPayload((p) => ({ ...p, app: e.target.value }))}>
                  <option value="">Выберите приложение</option>
                  {appOptions.map((appName) => <option key={appName} value={appName}>{appName}</option>)}
                </select>
              </div>
              <label className="composer-label">Текущий User-Agent</label>
              <Textarea readOnly value={uaPreview || "UA не найден"} />
              <div className="status">UA берётся из каталога и автоматически применяется при запросах.</div>
            </section>
          </div>
        </Modal>
      ) : null}

      {showShare && shareItem ? (
        <Modal onClose={() => setShowShare(false)} title={`Поделиться: ${shareItem.title}`} showCloseButton>
          <SharePanel
            shortUrl={shareItem.url || buildFullUrlWithOrigin(shareItem.payload, effectiveOrigin)}
            fullUrl={buildFullUrlWithOrigin(shareItem.payload, effectiveOrigin)}
            shareApps={shareApps}
            recommendedByOs={recommendedByOs}
            orderByOs={orderByOs}
            topMeta={shareModalMeta}
            topMetaLoading={shareModalMetaLoading}
            subscriptionFormat={shareItem.payload.output || ""}
            preferredOs={shareItem.payload.device || ""}
            preferredApp={shareItem.payload.app || ""}
            buildAppShareLink={buildAppShareLink}
            fetchGuide={fetchAppGuide}
            onCopy={(text) => { void copyToClipboard(text); }}
          />
        </Modal>
      ) : null}
      {showSubUsers && subUsersItem ? (
        <Modal onClose={() => setShowSubUsers(false)} title={`Пользователи: ${subUsersItem.title}`} showCloseButton>
          <div className="sub-users-layout">
            {subUsersLoading ? <div className="status">Загрузка...</div> : null}
            {!subUsersLoading && subUsersData ? (
              <>
                <section className="sub-users-policy">
                  <div className="sub-users-summary">
                    <span className="label">Всего: {subUsersData.summary.usersCount}</span>
                    <span className="label">Активных: {subUsersData.summary.activeCount}</span>
                    <span className="label">Заблокировано: {subUsersData.summary.blockedCount}</span>
                  </div>
                  <div className="row">
                    <TextInput
                      placeholder="Лимит пользователей (0 = без лимита)"
                      value={subUsersMax}
                      onChange={(e) => setSubUsersMax(e.target.value)}
                    />
                    <TipButton tip="Сохранить настройки" className="btn" onClick={() => void saveSubUsersPolicy()}>
                      Сохранить настройки
                    </TipButton>
                  </div>
                  <label className="composer-label">Текст при блокировке пользователя</label>
                  <TextInput
                    placeholder="Доступ к подписке заблокирован"
                    value={subUsersBlockedMessage}
                    onChange={(e) => setSubUsersBlockedMessage(e.target.value)}
                  />
                  <label className="composer-label">Текст при превышении лимита пользователей</label>
                  <TextInput
                    placeholder="Достигнут лимит пользователей для этой подписки"
                    value={subUsersLimitMessage}
                    onChange={(e) => setSubUsersLimitMessage(e.target.value)}
                  />
                </section>

                <section className="sub-users-list">
                  {subUsersData.users.length === 0 ? <article className="sub-card">Пользователи еще не подключались.</article> : null}
                  {subUsersData.users.map((user) => (
                    <article key={user.hwid} className="sub-card sub-user-card">
                      <div className="sub-head">
                        <div>
                          <div className="sub-name">{user.hwid}</div>
                          <div className="labels">
                            <span className="label">{user.blocked ? "blocked" : "active"}</span>
                            {user.lastSeen.deviceModel ? <span className="label">{user.lastSeen.deviceModel}</span> : null}
                            {user.lastSeen.app ? <span className="label">{user.lastSeen.app}</span> : null}
                            {user.lastSeen.device ? <span className="label">{user.lastSeen.device}</span> : null}
                          </div>
                        </div>
                        <div className="toolbar">
                          <TipButton
                            tip={user.blocked ? "Разблокировать пользователя" : "Заблокировать пользователя"}
                            className="btn"
                            onClick={() => void toggleSubUserBlocked(user.hwid, !user.blocked, user.blockReason)}
                          >
                            {user.blocked ? "Разблокировать" : "Блокировать"}
                          </TipButton>
                          <TipButton tip="Удалить пользователя и историю" className="btn" onClick={() => void removeSubUser(user.hwid)}>
                            Удалить
                          </TipButton>
                        </div>
                      </div>
                      <div className="status">
                        Первый запрос: {formatDateTime(user.firstSeenAt)} | Последний запрос: {formatDateTime(user.lastSeenAt)}
                      </div>
                      <div className="status">
                        IP: {user.lastSeen.ip || "—"} | UA: {user.lastSeen.userAgent || "—"}
                      </div>
                      {user.blocked && user.blockReason ? (
                        <div className="status">Текст блокировки: {user.blockReason}</div>
                      ) : null}
                      <div className="toolbar">
                        <TipButton
                          tip="Показать/скрыть историю изменений устройства"
                          className="btn"
                          onClick={() => setSubUsersExpandedHwid((prev) => (prev === user.hwid ? "" : user.hwid))}
                        >
                          {subUsersExpandedHwid === user.hwid ? "Скрыть историю" : "История изменений"}
                        </TipButton>
                      </div>
                      {subUsersExpandedHwid === user.hwid ? (
                        <div className="sub-user-history">
                          {user.history.length === 0 ? <div className="status">История изменений отсутствует.</div> : null}
                          {user.history.map((h, idx) => (
                            <article key={`${h.changedAt}-${idx}`} className="sub-user-history-item">
                              <div className="status">
                                {formatDateTime(h.changedAt)} [{h.eventType}]
                              </div>
                              <div className="status">
                                OS: {h.deviceOs || "—"} | Model: {h.deviceModel || "—"} | App: {h.app || "—"} | Device: {h.device || "—"}
                              </div>
                              <div className="status">
                                IP: {h.ip || "—"} | UA: {h.userAgent || "—"} | Lang: {h.acceptLanguage || "—"}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </section>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
      <NotificationToasts items={notifications} onDismiss={dismissNotification} />
    </main>
  );
}
