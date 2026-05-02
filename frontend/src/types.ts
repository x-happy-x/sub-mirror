export type Endpoint = "sub" | "last";
export type Output = "raw" | "raw_base64" | "json" | "yml";

export type SubscriptionPayload = {
  endpoint: Endpoint;
  sub_url: string;
  output: Output;
  output_auto?: string;
  app?: string;
  device?: string;
  profile?: string;
  profiles?: string;
  hwid?: string;
};

export type FavoriteItem = {
  title: string;
  url: string;
  payload: SubscriptionPayload;
  labels: string[];
  shortId?: string;
  permissions?: ShortLinkPermissions;
  ts: number;
};

export type ShortLinkPermissions = {
  canView: boolean;
  canEdit: boolean;
  canManageAccess: boolean;
  accessLevel: "" | "view" | "edit";
};

export type ShortLinkAccessGrant = {
  username: string;
  role: "user" | "admin";
  accessLevel: "view" | "edit";
};

export type ImportedProxyItem = {
  index: number;
  flag: string;
  name: string;
  normalizedName: string;
  normalizedUri: string;
  uri: string;
  type: string;
  server: string;
  port: number;
  uuid: string;
  password: string;
  network: string;
  security: string;
  sni: string;
  servername: string;
  flow: string;
  fp: string;
  clientFingerprint: string;
  pbk: string;
  publicKey: string;
  sid: string;
  shortId: string;
  path: string;
  host: string;
  serviceName: string;
  transport: Record<string, string>;
};

export type SubTestResponse = {
  ok: boolean;
  request?: {
    endpoint: Endpoint;
    subUrl: string;
    output: string;
    app?: string;
    device?: string;
    profiles?: string[];
  };
  upstream?: {
    status: number;
    url: string;
    bodyBytes: number;
    sourceFormat: string;
    servers: string[];
    body?: string;
  };
  conversion?: {
    ok: boolean;
    conversion?: string;
    outputFormat?: string;
    error?: string;
    servers?: string[];
    body?: string;
  };
  cache?: {
    exists: boolean;
    validation?: {
      ok: boolean;
      error?: string;
    };
  };
  error?: string;
};

export type ProfileCatalog = {
  profiles: string[];
  items?: ProfileCatalogItem[];
};

export type ProfileCatalogItem = {
  name: string;
  ownerUsername: string;
  editable: boolean;
  visibility: "shared" | "private";
  source: "builtin" | "custom";
};

export type UACatalog = {
  options: Record<string, Record<string, string>>;
  defaultUa?: string;
};

export type MockSourceConfig = {
  preset: string;
  status: number;
  contentType: string;
  body: string;
  headers: Record<string, string>;
  delayMs: number;
};

export type MockSource = {
  id: string;
  config: MockSourceConfig;
  logsCount?: number;
  meta?: {
    ownerUsername?: string;
    mode?: string;
    label?: string;
  };
};

export type MockLogEntry = {
  ts: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  bodyBytes?: number;
};

export type AuthUser = {
  username: string;
  role: "user" | "admin";
};

export type ShortLinkUserHistoryEntry = {
  eventType: string;
  changedAt: string;
  ip: string;
  userAgent: string;
  deviceModel: string;
  deviceOs: string;
  app: string;
  device: string;
  acceptLanguage: string;
};

export type ShortLinkUserItem = {
  hwid: string;
  firstSeenAt: string;
  lastSeenAt: string;
  blocked: boolean;
  blockReason: string;
  lastSeen: {
    ip: string;
    userAgent: string;
    deviceModel: string;
    deviceOs: string;
    app: string;
    device: string;
    acceptLanguage: string;
  };
  history: ShortLinkUserHistoryEntry[];
};

export type ShortLinkUsersData = {
  shortLinkId: string;
  policy: {
    maxUsers: number;
    blockedMessage: string;
    limitMessage: string;
    updatedAt: string;
  };
  summary: {
    usersCount: number;
    blockedCount: number;
    activeCount: number;
  };
  users: ShortLinkUserItem[];
};
