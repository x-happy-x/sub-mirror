import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

test("snapshot storage foundation saves feed metadata and prunes old files", async () => {
  const dataDir = path.resolve(process.cwd(), ".tmp-test-data", `snapshots-${crypto.randomBytes(4).toString("hex")}`);
  process.env.SUB_MIRROR_DATA_DIR = dataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });

  const {
    buildSubscriptionFeedKey,
    upsertSubscriptionFeed,
    getSubscriptionFeedByKey,
    createSourceSnapshot,
    getLatestSourceSnapshotForFeed,
    listSourceSnapshotsForFeed,
    createNormalizedSnapshot,
    getNormalizedSnapshotBySourceSnapshotId,
  } = await import("./sqlite-store.js");
  const {
    writeRawSourceSnapshotBody,
    writeNormalizedSnapshotFile,
    readSnapshotFile,
    pruneStoredSnapshots,
  } = await import("./source-snapshots.js");

  const token = crypto.randomBytes(6).toString("hex");
  const feedKey = buildSubscriptionFeedKey({
    subUrl: `https://example.com/sub-${token}`,
    app: "flclashx",
    device: "android",
    profiles: ["xiaomi", "auto"],
    hwid: `hwid-${token}`,
  });

  const feed = await upsertSubscriptionFeed({
    feedKey,
    subUrl: `https://example.com/sub-${token}`,
    app: "flclashx",
    device: "android",
    profiles: ["xiaomi", "auto"],
    hwid: `hwid-${token}`,
  });
  assert.ok(feed.id > 0);

  const fetchedFeed = await getSubscriptionFeedByKey(feedKey);
  assert.equal(fetchedFeed?.id, feed.id);
  assert.deepEqual(fetchedFeed?.profileNames, ["auto", "xiaomi"]);

  const raw1 = writeRawSourceSnapshotBody(`raw-${token}-1`, "vless://one");
  const source1 = await createSourceSnapshot({
    feedId: feed.id,
    fetchedAt: "2026-04-15T10:00:00.000Z",
    fetchedByType: "test",
    fetchedById: token,
    requestContext: { token, seq: 1 },
    responseStatus: 200,
    responseUrl: "https://example.com/final-1",
    responseHeaders: { "content-type": "text/plain" },
    bodyPath: raw1.path,
    bodySha256: raw1.sha256,
    bodyBytes: raw1.bytes,
    sourceFormat: "raw",
    sourceFormatDetails: { encoding: "plain" },
  });
  const normalized1 = writeNormalizedSnapshotFile(`normalized-${token}-1`, { nodes: [{ id: "one" }] });
  await createNormalizedSnapshot({
    feedId: feed.id,
    sourceSnapshotId: source1.id,
    schemaVersion: 1,
    parserVersion: "test-v1",
    normalizedPath: normalized1.path,
    normalizedSha256: normalized1.sha256,
    warnings: [],
    lossFlags: [],
  });

  const raw2 = writeRawSourceSnapshotBody(`raw-${token}-2`, "vless://two");
  const source2 = await createSourceSnapshot({
    feedId: feed.id,
    fetchedAt: "2026-04-15T10:05:00.000Z",
    fetchedByType: "test",
    fetchedById: token,
    requestContext: { token, seq: 2 },
    responseStatus: 200,
    responseUrl: "https://example.com/final-2",
    responseHeaders: { "content-type": "text/plain" },
    bodyPath: raw2.path,
    bodySha256: raw2.sha256,
    bodyBytes: raw2.bytes,
    sourceFormat: "raw",
    sourceFormatDetails: { encoding: "plain" },
  });
  const normalized2 = writeNormalizedSnapshotFile(`normalized-${token}-2`, { nodes: [{ id: "two" }] });
  await createNormalizedSnapshot({
    feedId: feed.id,
    sourceSnapshotId: source2.id,
    schemaVersion: 1,
    parserVersion: "test-v1",
    normalizedPath: normalized2.path,
    normalizedSha256: normalized2.sha256,
    warnings: ["warn"],
    lossFlags: ["loss"],
  });

  const latest = await getLatestSourceSnapshotForFeed(feed.id);
  assert.equal(latest?.id, source2.id);
  assert.equal(readSnapshotFile(latest?.bodyPath), "vless://two");

  const normalizedLatest = await getNormalizedSnapshotBySourceSnapshotId(source2.id);
  assert.equal(normalizedLatest?.sourceSnapshotId, source2.id);
  assert.deepEqual(normalizedLatest?.warnings, ["warn"]);
  assert.deepEqual(normalizedLatest?.lossFlags, ["loss"]);

  const listed = await listSourceSnapshotsForFeed(feed.id, 10);
  assert.equal(listed.length >= 2, true);

  const removed = await pruneStoredSnapshots(feed.id, 1);
  assert.equal(removed.length >= 1, true);
  assert.equal(removed.some((item) => item.sourceSnapshotId === source1.id), true);

  const afterPrune = await listSourceSnapshotsForFeed(feed.id, 10);
  assert.equal(afterPrune[0]?.id, source2.id);
  assert.equal(afterPrune.some((item) => item.id === source1.id), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("successful fetch snapshot stores raw body and detected format", async () => {
  const dataDir = path.resolve(process.cwd(), ".tmp-test-data", `fetch-snapshots-${crypto.randomBytes(4).toString("hex")}`);
  process.env.SUB_MIRROR_DATA_DIR = dataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });

  const {
    buildSubscriptionFeedKey,
    getSubscriptionFeedByKey,
    getLatestSourceSnapshotForFeed,
    getNormalizedSnapshotBySourceSnapshotId,
  } = await import("./sqlite-store.js");
  const { readSnapshotFile } = await import("./source-snapshots.js");
  const { persistSuccessfulSourceSnapshot } = await import("./subscription.js");

  const subUrl = "https://example.com/sub-json";
  const feedKey = buildSubscriptionFeedKey({
    subUrl,
    app: "flclashx",
    device: "android",
    profiles: ["auto"],
    hwid: "hwid-json",
  });

  const stored = await persistSuccessfulSourceSnapshot({
    route: "/sub",
    subUrl,
    output: "json",
    profileNames: ["auto"],
    app: "flclashx",
    device: "android",
    forwardHeaders: { "x-hwid": "hwid-json", "user-agent": "UA/Test" },
    fetched: {
      body: '[{"outbounds":[{"tag":"a","protocol":"vless","settings":{"vnext":[{"address":"example.com","port":443,"users":[{"id":"11111111-1111-4111-8111-111111111111","encryption":"none"}]}]}}],"remarks":"Demo"}]',
      responseHeaders: { "content-type": "application/json; charset=utf-8" },
      responseStatus: 200,
      responseUrl: subUrl,
    },
  });

  assert.ok(stored?.id > 0);
  assert.equal(stored?.sourceFormat, "json");

  const feed = await getSubscriptionFeedByKey(feedKey);
  assert.ok(feed?.id > 0);
  assert.equal(feed?.lastSuccessSourceSnapshotId, stored.id);

  const latest = await getLatestSourceSnapshotForFeed(feed.id);
  assert.equal(latest?.id, stored.id);
  assert.equal(readSnapshotFile(latest?.bodyPath).includes('"protocol":"vless"'), true);
  assert.equal(latest?.requestContext?.route, "/sub");
  assert.equal(latest?.requestContext?.output, "json");
  assert.equal(latest?.requestContext?.forwardHeaders?.["x-hwid"], "hwid-json");

  const normalized = await getNormalizedSnapshotBySourceSnapshotId(stored.id);
  assert.ok(normalized?.id > 0);
  assert.equal(normalized?.parserVersion, "normalized-v1");
  const normalizedBody = JSON.parse(readSnapshotFile(normalized?.normalizedPath));
  assert.equal(normalizedBody?.meta?.sourceFormat, "json");
  assert.equal(Array.isArray(normalizedBody?.nodes), true);
  assert.equal(normalizedBody?.nodes?.[0]?.type, "vless");
  assert.equal(Array.isArray(normalizedBody?.policy?.outbounds), true);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("normalized snapshot can render raw and json outputs", async () => {
  const dataDir = path.resolve(process.cwd(), ".tmp-test-data", `normalized-render-${crypto.randomBytes(4).toString("hex")}`);
  process.env.SUB_MIRROR_DATA_DIR = dataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });

  const { renderOutputFromNormalized, sourceFormatMatchesOutput, persistSuccessfulSourceSnapshot } = await import("./subscription.js");
  const { getNormalizedSnapshotBySourceSnapshotId } = await import("./sqlite-store.js");
  const { readSnapshotFile } = await import("./source-snapshots.js");

  const stored = await persistSuccessfulSourceSnapshot({
    route: "/sub",
    subUrl: "https://example.com/sub-raw",
    output: "raw",
    profileNames: [],
    app: "",
    device: "",
    forwardHeaders: {},
    fetched: {
      body: "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=tls#demo",
      responseHeaders: { "content-type": "text/plain; charset=utf-8" },
      responseStatus: 200,
      responseUrl: "https://example.com/sub-raw",
    },
  });

  const normalized = await getNormalizedSnapshotBySourceSnapshotId(stored.id);
  const normalizedBody = JSON.parse(readSnapshotFile(normalized.normalizedPath));

  const rawResult = await renderOutputFromNormalized(normalizedBody, "raw");
  assert.equal(rawResult.ok, true);
  assert.match(String(rawResult.body), /^vless:\/\//);

  const jsonResult = await renderOutputFromNormalized(normalizedBody, "json");
  assert.equal(jsonResult.ok, true);
  const parsedJson = JSON.parse(String(jsonResult.body));
  assert.ok(Array.isArray(parsedJson));
  assert.equal(parsedJson[0].outbounds?.[0]?.protocol, "vless");

  assert.equal(sourceFormatMatchesOutput("raw", "raw"), true);
  assert.equal(sourceFormatMatchesOutput("json", "json"), true);
  assert.equal(sourceFormatMatchesOutput("yml", "clash"), true);
  assert.equal(sourceFormatMatchesOutput("raw(base64)", "raw_base64"), true);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("json normalized renderer preserves native xray bundle structure", async () => {
  const dataDir = path.resolve(process.cwd(), ".tmp-test-data", `normalized-json-native-${crypto.randomBytes(4).toString("hex")}`);
  process.env.SUB_MIRROR_DATA_DIR = dataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });

  const { persistSuccessfulSourceSnapshot, renderOutputFromNormalized } = await import("./subscription.js");
  const { getNormalizedSnapshotBySourceSnapshotId } = await import("./sqlite-store.js");
  const { readSnapshotFile } = await import("./source-snapshots.js");

  const jsonBody = JSON.stringify([
    {
      remarks: "Auto DE",
      observatory: {
        subjectSelector: ["node-a", "node-b"],
      },
      outbounds: [
        {
          tag: "node-a",
          protocol: "vless",
          settings: {
            vnext: [
              {
                address: "example.com",
                port: 443,
                users: [
                  {
                    id: "11111111-1111-4111-8111-111111111111",
                    encryption: "none",
                  },
                ],
              },
            ],
          },
        },
      ],
      routing: {
        balancers: [
          {
            tag: "bal-1",
            selector: ["node-a"],
            fallbackTag: "node-b",
            strategy: { type: "leastLoad" },
          },
        ],
        rules: [
          {
            type: "field",
            balancerTag: "bal-1",
          },
        ],
      },
    },
  ]);

  const stored = await persistSuccessfulSourceSnapshot({
    route: "/sub",
    subUrl: "https://example.com/xray-json",
    output: "json",
    profileNames: ["auto"],
    app: "flclashx",
    device: "android",
    forwardHeaders: {},
    fetched: {
      body: jsonBody,
      responseHeaders: { "content-type": "application/json; charset=utf-8" },
      responseStatus: 200,
      responseUrl: "https://example.com/xray-json",
    },
  });

  const normalized = await getNormalizedSnapshotBySourceSnapshotId(stored.id);
  const normalizedBody = JSON.parse(readSnapshotFile(normalized.normalizedPath));
  const rendered = await renderOutputFromNormalized(normalizedBody, "json");

  assert.equal(rendered.ok, true);
  assert.equal(rendered.conversion, "normalized-json-native");
  const parsed = JSON.parse(String(rendered.body));
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].remarks, "Auto DE");
  assert.equal(parsed[0].routing?.balancers?.[0]?.tag, "bal-1");
  assert.deepEqual(parsed[0].observatory?.subjectSelector, ["node-a", "node-b"]);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("yaml normalized renderer preserves clash groups and rules", async () => {
  const dataDir = path.resolve(process.cwd(), ".tmp-test-data", `normalized-clash-native-${crypto.randomBytes(4).toString("hex")}`);
  process.env.SUB_MIRROR_DATA_DIR = dataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });

  const { persistSuccessfulSourceSnapshot, renderClashFromNormalized } = await import("./subscription.js");
  const { getNormalizedSnapshotBySourceSnapshotId } = await import("./sqlite-store.js");
  const { readSnapshotFile } = await import("./source-snapshots.js");

  const yamlBody = [
    "mixed-port: 7890",
    "mode: rule",
    "dns:",
    "  enable: true",
    "proxies:",
    "  - name: Alpha",
    "    type: ss",
    "    server: 1.1.1.1",
    "    port: 443",
    "    cipher: aes-128-gcm",
    "    password: secret",
    "proxy-groups:",
    "  - name: AUTO",
    "    type: url-test",
    "    proxies:",
    "      - Alpha",
    "    url: http://www.gstatic.com/generate_204",
    "rules:",
    "  - MATCH,AUTO",
  ].join("\n");

  const stored = await persistSuccessfulSourceSnapshot({
    route: "/sub",
    subUrl: "https://example.com/clash-yaml",
    output: "clash",
    profileNames: [],
    app: "flclashx",
    device: "android",
    forwardHeaders: {},
    fetched: {
      body: yamlBody,
      responseHeaders: { "content-type": "text/yaml; charset=utf-8" },
      responseStatus: 200,
      responseUrl: "https://example.com/clash-yaml",
    },
  });

  const normalized = await getNormalizedSnapshotBySourceSnapshotId(stored.id);
  const normalizedBody = JSON.parse(readSnapshotFile(normalized.normalizedPath));
  assert.equal(Array.isArray(normalizedBody?.topology?.proxyGroups), true);
  assert.equal(normalizedBody?.topology?.proxyGroups?.[0]?.name, "AUTO");
  assert.deepEqual(normalizedBody?.policy?.rules, ["MATCH,AUTO"]);
  assert.match(String(normalizedBody?.policy?.dns?.raw || ""), /^dns:/m);

  const rendered = await renderClashFromNormalized(normalizedBody);
  assert.equal(rendered.ok, true);
  assert.equal(rendered.conversion, "normalized-clash-native");
  assert.match(String(rendered.body), /^proxy-groups:\s*$/m);
  assert.match(String(rendered.body), /^rules:\s*$/m);
  assert.match(String(rendered.body), /^dns:\s*$/m);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("subscription overrides are stored and applied to normalized nodes", async () => {
  const dataDir = path.resolve(process.cwd(), ".tmp-test-data", `overrides-${crypto.randomBytes(4).toString("hex")}`);
  process.env.SUB_MIRROR_DATA_DIR = dataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });

  const {
    buildSubscriptionFeedKey,
    getSubscriptionFeedByKey,
    getNormalizedSnapshotBySourceSnapshotId,
    upsertSubscriptionOverrides,
    getSubscriptionOverridesForFeed,
  } = await import("./sqlite-store.js");
  const {
    persistSuccessfulSourceSnapshot,
    applyOverridesToNormalized,
    hasMeaningfulOverrides,
    renderOutputFromNormalized,
  } = await import("./subscription.js");
  const { readSnapshotFile } = await import("./source-snapshots.js");

  const stored = await persistSuccessfulSourceSnapshot({
    route: "/sub",
    subUrl: "https://example.com/override-raw",
    output: "raw",
    profileNames: ["auto"],
    app: "flclashx",
    device: "android",
    forwardHeaders: { "x-hwid": "hwid-override" },
    fetched: {
      body: [
        "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=tls#Node One",
        "vless://22222222-2222-4222-8222-222222222222@example.com:443?type=tcp&security=tls#Node Two",
      ].join("\n"),
      responseHeaders: { "content-type": "text/plain; charset=utf-8" },
      responseStatus: 200,
      responseUrl: "https://example.com/override-raw",
    },
  });

  const feedKey = buildSubscriptionFeedKey({
    subUrl: "https://example.com/override-raw",
    app: "flclashx",
    device: "android",
    profiles: ["auto"],
    hwid: "hwid-override",
  });
  const feed = await getSubscriptionFeedByKey(feedKey);
  assert.ok(feed?.id > 0);

  const savedOverrides = await upsertSubscriptionOverrides(feed.id, {
    nodes: {
      byId: {
        "node-0001": { name: "Renamed One" },
      },
      disabledIds: ["node-0002"],
    },
  });
  assert.ok(savedOverrides?.id > 0);
  assert.equal(savedOverrides.version, 1);

  const loadedOverrides = await getSubscriptionOverridesForFeed(feed.id);
  assert.equal(hasMeaningfulOverrides(loadedOverrides?.overrides), true);

  const normalized = await getNormalizedSnapshotBySourceSnapshotId(stored.id);
  const normalizedBody = JSON.parse(readSnapshotFile(normalized.normalizedPath));
  const effective = applyOverridesToNormalized(normalizedBody, {
    ...loadedOverrides.overrides,
    version: loadedOverrides.version,
  });

  assert.equal(effective.nodes.length, 1);
  assert.equal(effective.nodes[0].name, "Renamed One");
  assert.equal(effective.meta?.overridesApplied, true);

  const rawRendered = await renderOutputFromNormalized(effective, "raw");
  assert.equal(rawRendered.ok, true);
  assert.match(String(rawRendered.body), /Node One/);
  assert.doesNotMatch(String(rawRendered.body), /Node Two/);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("structural overrides update topology/policy and disable native render shortcut", async () => {
  const dataDir = path.resolve(process.cwd(), ".tmp-test-data", `structural-overrides-${crypto.randomBytes(4).toString("hex")}`);
  process.env.SUB_MIRROR_DATA_DIR = dataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });

  const {
    persistSuccessfulSourceSnapshot,
    applyOverridesToNormalized,
    renderOutputFromNormalized,
    renderClashFromNormalized,
  } = await import("./subscription.js");
  const { getNormalizedSnapshotBySourceSnapshotId } = await import("./sqlite-store.js");
  const { readSnapshotFile } = await import("./source-snapshots.js");

  const yamlBody = [
    "mixed-port: 7890",
    "mode: rule",
    "proxies:",
    "  - name: Alpha",
    "    type: ss",
    "    server: 1.1.1.1",
    "    port: 443",
    "    cipher: aes-128-gcm",
    "    password: secret",
    "proxy-groups:",
    "  - name: AUTO",
    "    type: url-test",
    "rules:",
    "  - MATCH,AUTO",
  ].join("\n");

  const stored = await persistSuccessfulSourceSnapshot({
    route: "/sub",
    subUrl: "https://example.com/structural-clash",
    output: "clash",
    profileNames: [],
    app: "",
    device: "",
    forwardHeaders: {},
    fetched: {
      body: yamlBody,
      responseHeaders: { "content-type": "text/yaml; charset=utf-8" },
      responseStatus: 200,
      responseUrl: "https://example.com/structural-clash",
    },
  });

  const normalized = await getNormalizedSnapshotBySourceSnapshotId(stored.id);
  const normalizedBody = JSON.parse(readSnapshotFile(normalized.normalizedPath));
  const effective = applyOverridesToNormalized(normalizedBody, {
    topology: {
      proxyGroups: {
        byName: {
          AUTO: { type: "select" },
        },
      },
    },
    policy: {
      rules: {
        replace: ["MATCH,DIRECT"],
      },
    },
  });

  assert.equal(effective.topology.proxyGroups[0].type, "select");
  assert.deepEqual(effective.policy.rules, ["MATCH,DIRECT"]);
  assert.equal(effective.meta?.overridesApplied, true);

  const clashRendered = await renderClashFromNormalized(effective);
  assert.equal(clashRendered.ok, true);
  assert.equal(clashRendered.conversion, "normalized-clash-patched");
  assert.match(String(clashRendered.body), /type:\s*select/);
  assert.match(String(clashRendered.body), /MATCH,DIRECT/);

  const jsonRendered = await renderOutputFromNormalized(effective, "json");
  assert.equal(jsonRendered.ok, true);
  assert.notEqual(jsonRendered.conversion, "normalized-json-native");

  fs.rmSync(dataDir, { recursive: true, force: true });
});
