export type Endpoint = "sub" | "last";
export type Output = "raw" | "raw_base64" | "json" | "yml";

export type SubscriptionPayload = {
  endpoint: Endpoint;
  sub_url: string;
  output: Output;
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
  ts: number;
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
