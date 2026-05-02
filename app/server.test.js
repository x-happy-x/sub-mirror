import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalizeOutput,
  parseServersFromText,
  renderHomePage,
  readProfileFile,
  pickUserAgentProfile,
  resolveAppKeyFromUserAgent,
  resolveOutputFromUserAgent,
  resolveLocalSourcePath,
  resolveRequestConfig,
  resolveShortLinkTypeOverride,
  produceOutput,
  fetchWithNode,
} from "./server.js";

test("normalizeOutput supports aliases", () => {
  assert.equal(normalizeOutput("yml"), "clash");
  assert.equal(normalizeOutput("yaml"), "clash");
  assert.equal(normalizeOutput("clash"), "clash");
  assert.equal(normalizeOutput("raw"), "raw");
  assert.equal(normalizeOutput("raw_base64"), "raw_base64");
  assert.equal(normalizeOutput("raw-base64"), "raw_base64");
  assert.equal(normalizeOutput("json"), "json");
  assert.equal(normalizeOutput("source"), "raw");
  assert.equal(normalizeOutput("unknown"), null);
});

test("base profiles are loaded from profiles directory", () => {
  const base = readProfileFile("xiaomi");
  assert.ok(base);
  assert.equal(base.headers["x-device-os"], "Android");
});

test("ua profile selection prefers app+device and falls back to ua-default", () => {
  const specific = pickUserAgentProfile("flclashx", "android");
  assert.equal(specific.ok, true);
  assert.equal(specific.headers["user-agent"], "FlClash X/0.3.2 Platform/android");

  const fallback = pickUserAgentProfile("unknown-app", "android");
  assert.equal(fallback.ok, true);
  assert.equal(fallback.headers["user-agent"], "SubLab/UA Default (Windows)");
});

test("output auto resolves known app format from request user-agent", () => {
  assert.equal(resolveAppKeyFromUserAgent("FlClash X/0.3.2 Platform/android"), "flclashx");
  assert.equal(resolveOutputFromUserAgent("FlClash X/0.3.2 Platform/android", "raw").output, "clash");
  assert.equal(resolveOutputFromUserAgent("Happ/3.10.0/iOS", "yml").output, "raw");
  assert.equal(resolveAppKeyFromUserAgent("Happ/3.18.3/Android/17771400994551771562"), "happ");
  assert.equal(resolveOutputFromUserAgent("Happ/3.18.3/Android/17771400994551771562", "yml").output, "raw");
  assert.equal(resolveAppKeyFromUserAgent("clash.meta/v1.19.24"), "clash-meta");
  assert.equal(resolveOutputFromUserAgent("clash.meta/v1.19.24", "raw").output, "clash");
  assert.equal(resolveAppKeyFromUserAgent("FlClash X/v0.3.2 Platform/android"), "flclashx");
  assert.equal(resolveOutputFromUserAgent("FlClash X/v0.3.2 Platform/android", "raw").output, "clash");
  assert.equal(resolveAppKeyFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Mobile/15E148 Safari/604.1"), "");
  assert.equal(resolveOutputFromUserAgent("Unknown Client/1.0", "raw").output, "raw");
});

test("request config merges base and auto ua profiles with output alias", () => {
  const reqUrl = new URL(
    "http://localhost/last?app=flclashx&device=android&output=yml&profile=xiaomi&sub_url=https://example.com/sub",
  );
  const result = resolveRequestConfig(reqUrl, {});
  assert.equal(result.ok, true);
  assert.equal(result.output, "clash");
  assert.deepEqual(result.profileNames, ["xiaomi"]);
  assert.equal(result.forwardHeaders["x-device-os"], "Android");
  assert.equal(result.forwardHeaders["user-agent"], "FlClash X/0.3.2 Platform/android");
});

test("request config output_auto uses request user-agent when present", () => {
  const reqUrl = new URL(
    "http://localhost/last?output=yml&output_auto=1&sub_url=https://example.com/sub",
  );
  const result = resolveRequestConfig(reqUrl, {
    "user-agent": "Happ/3.10.0/iOS",
  });
  assert.equal(result.ok, true);
  assert.equal(result.outputAuto, true);
  assert.equal(result.output, "raw");
});

test("request config output_auto falls back when user-agent is missing", () => {
  const reqUrl = new URL(
    "http://localhost/last?output=raw_base64&output_auto=1&sub_url=https://example.com/sub",
  );
  const result = resolveRequestConfig(reqUrl, {});
  assert.equal(result.ok, true);
  assert.equal(result.outputAuto, true);
  assert.equal(result.output, "raw_base64");
});

test("short-link type override normalizes raw and clash aliases", () => {
  assert.equal(resolveShortLinkTypeOverride(new URL("http://localhost/l/test?type=raw")), "raw");
  assert.equal(resolveShortLinkTypeOverride(new URL("http://localhost/l/test?type=yaml")), "yml");
  assert.equal(resolveShortLinkTypeOverride(new URL("http://localhost/l/test?type=clash")), "yml");
  assert.equal(resolveShortLinkTypeOverride(new URL("http://localhost/l/test")), "");
});

test("local source path resolves bundled bypass list", () => {
  const localPath = resolveLocalSourcePath("app/test-fixtures/local-source.txt");
  assert.ok(localPath.endsWith("app/test-fixtures/local-source.txt"));
});

test("fetchWithNode reads local bypass list file", async () => {
  const fetched = await fetchWithNode("app/test-fixtures/local-source.txt", {});
  assert.equal(fetched.responseStatus, 200);
  assert.match(fetched.responseUrl, /^file:\/\//);
  assert.match(fetched.body, /^vless:\/\//m);
});

test("ua profile headers are locked and cannot be overridden by request headers", () => {
  const reqUrl = new URL("http://localhost/last?app=flclashx&device=android&sub_url=https://example.com/sub");
  const result = resolveRequestConfig(reqUrl, {
    "user-agent": "BadUA/9.9.9",
    "x-user-agent": "BadUA/9.9.9",
  });
  assert.equal(result.ok, true);
  assert.equal(result.forwardHeaders["user-agent"], "FlClash X/0.3.2 Platform/android");
});

test("produceOutput returns expected content types for raw and clash", async () => {
  const rawResult = await produceOutput("vless://example", "raw");
  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.contentType, "text/plain; charset=utf-8");

  const yamlInput = "proxies:\n  - name: test\n    type: ss\n    server: 1.1.1.1\n    port: 443\n";
  const clashResult = await produceOutput(yamlInput, "clash");
  assert.equal(clashResult.ok, true);
  assert.equal(clashResult.contentType, "text/yaml; charset=utf-8");
});

test("produceOutput supports raw base64 and json outputs", async () => {
  const rawInput = "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=tls#test";

  const base64Result = await produceOutput(rawInput, "raw_base64");
  assert.equal(base64Result.ok, true);
  assert.equal(base64Result.contentType, "text/plain; charset=utf-8");
  assert.equal(Buffer.from(String(base64Result.body), "base64").toString("utf8"), rawInput);

  const jsonResult = await produceOutput(rawInput, "json");
  assert.equal(jsonResult.ok, true);
  assert.equal(jsonResult.contentType, "application/json; charset=utf-8");
  const parsedJson = JSON.parse(String(jsonResult.body));
  assert.ok(Array.isArray(parsedJson));
  assert.equal(parsedJson.length, 1);
  assert.equal(parsedJson[0].remarks, "test");
  assert.equal(parsedJson[0].outbounds?.[0]?.protocol, "vless");
  assert.equal(parsedJson[0].outbounds?.[0]?.settings?.vnext?.[0]?.address, "example.com");
  assert.equal(parsedJson[0].routing?.rules?.[1]?.outboundTag, "node-0001");
});

test("produceOutput wraps clash output for flclashx into full config", async () => {
  const yamlInput = "proxies:\n  - name: test\n    type: ss\n    server: 1.1.1.1\n    port: 443\n    cipher: aes-128-gcm\n    password: secret\n";
  const clashResult = await produceOutput(yamlInput, "clash", { app: "flclashx" });

  assert.equal(clashResult.ok, true);
  assert.match(clashResult.body, /^mixed-port:\s*7890$/m);
  assert.match(clashResult.body, /^proxy-groups:\s*$/m);
  assert.match(clashResult.body, /^rules:\s*$/m);
  assert.match(clashResult.body, /name:\s*AUTO/);
  assert.match(clashResult.body, /name:\s*PROXY/);
  assert.match(clashResult.body, /MATCH,PROXY/);
});

test("produceOutput does not double-wrap full clash config for flclashx", async () => {
  const yamlInput = [
    "mixed-port: 7890",
    "allow-lan: true",
    "mode: rule",
    "proxies:",
    "  - name: Alpha",
    "    type: ss",
    "    server: 1.1.1.1",
    "    port: 443",
    "    cipher: aes-128-gcm",
    "    password: secret",
    "proxy-groups:",
    "  - name: PROXY",
    "    type: select",
    "    proxies:",
    "      - Alpha",
    "rules:",
    "  - MATCH,PROXY",
  ].join("\n");
  const clashResult = await produceOutput(yamlInput, "clash", { app: "flclashx" });

  assert.equal(clashResult.ok, true);
  assert.equal(clashResult.body, yamlInput);
  assert.equal((clashResult.body.match(/^proxy-groups:\s*$/gm) || []).length, 1);
  assert.equal((clashResult.body.match(/^rules:\s*$/gm) || []).length, 1);
});

test("parseServersFromText reads multiline clash proxy items", () => {
  const yamlInput = [
    "proxies:",
    "  -",
    "    name: \"Alpha\"",
    "    type: vless",
    "  -",
    "    name: \"Beta\"",
    "    type: vless",
    "proxy-groups:",
    "  - name: AUTO",
  ].join("\n");

  assert.deepEqual(parseServersFromText(yamlInput), ["Alpha", "Beta"]);
});

test("produceOutput converts clash yaml fixture to raw URI list", async () => {
  const fixturePath = new URL("./test-fixtures/subscription-yml-sample.yml", import.meta.url);
  const yamlInput = fs.readFileSync(fixturePath, "utf8");
  const rawResult = await produceOutput(yamlInput, "raw");

  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.contentType, "text/plain; charset=utf-8");
  assert.equal(typeof rawResult.body, "string");

  const uriLines = rawResult.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("vless://") || line.startsWith("vmess://") || line.startsWith("ss://") || line.startsWith("trojan://") || line.startsWith("ssr://"));

  assert.ok(uriLines.length >= 4, "expected at least 4 raw URIs after yaml->raw conversion");
  assert.ok(uriLines.some((line) => line.includes("security=reality")), "expected reality security for reality nodes");
  assert.ok(uriLines.some((line) => line.includes("pbk=EXAMPLE_PUBLIC_KEY_001")), "expected public key in converted raw URI");
  assert.ok(uriLines.some((line) => line.includes("sid=aa11bb22cc33dd44")), "expected short id in converted raw URI");
  assert.ok(uriLines.some((line) => line.includes("fp=chrome")), "expected fingerprint in converted raw URI");
  assert.ok(uriLines.some((line) => line.includes("flow=xtls-rprx-vision")), "expected flow in converted raw URI");
  assert.ok(uriLines.some((line) => line.includes("path=%2Fws")), "expected ws path in converted raw URI");
  assert.ok(uriLines.some((line) => line.includes("host=ws.example.net")), "expected ws host in converted raw URI");
});

test("produceOutput converts JSON outbound bundle fixture to raw URI list", async () => {
  const fixturePath = new URL("./test-fixtures/raw.json", import.meta.url);
  const jsonInput = fs.readFileSync(fixturePath, "utf8");
  const rawResult = await produceOutput(jsonInput, "raw");

  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.contentType, "text/plain; charset=utf-8");
  assert.equal(typeof rawResult.body, "string");
  assert.match(rawResult.conversion, /json-fallback-raw|none-raw/);

  const uriLines = rawResult.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("vless://"));

  assert.ok(uriLines.length >= 31, "expected vless URIs extracted from JSON outbounds");
  assert.ok(uriLines.some((line) => line.includes("security=reality")), "expected reality params in extracted URIs");
  assert.ok(uriLines.some((line) => line.includes("#%D0%A1%D0%B0%D0%BC%D1%8B%D0%B9%20%D0%91%D1%8B%D1%81%D1%82%D1%80%D1%8B%D0%B9")), "expected encoded remarks in URI names");
});

test("produceOutput converts JSON outbound bundle fixture to clash yaml", async () => {
  const fixturePath = new URL("./test-fixtures/raw.json", import.meta.url);
  const jsonInput = fs.readFileSync(fixturePath, "utf8");
  const clashResult = await produceOutput(jsonInput, "clash");

  assert.equal(clashResult.ok, true);
  assert.equal(clashResult.contentType, "text/yaml; charset=utf-8");
  assert.equal(typeof clashResult.body, "string");
  assert.match(clashResult.body, /^proxies:\s*$/m);
  assert.match(clashResult.body, /type:\s*vless/);
  assert.match(clashResult.body, /servername:\s*tradingview\.com/);
});

test("home page contains form, qr and app buttons", () => {
  const html = renderHomePage();
  assert.ok(html.includes("Sub Mirror"));
  assert.ok(html.includes('id="sub_url"'));
  assert.ok(html.includes('id="output"'));
  assert.ok(html.includes('id="openHapp"'));
  assert.ok(html.includes('id="openFl"'));
  assert.ok(html.includes("api.qrserver.com"));
});
