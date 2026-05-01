import { useEffect, useMemo, useState } from "react";
import { Button, Textarea } from "@x-happy-x/ui-kit";
import type { NotificationLevel } from "@x-happy-x/ui-kit";
import type { FavoriteItem } from "../types";
import { fetchShortLinkOverrides, previewShortLinkOverrides, updateShortLinkOverrides } from "../lib/api";
import { Modal } from "./Modal";

type Props = {
  item: FavoriteItem;
  onClose: () => void;
  onNotify: (level: NotificationLevel, message: string) => void;
};

type EditorMode = "raw" | "clash" | "json";

type DraftState = {
  nodesByNameText: string;
  disabledIdsText: string;
  clashProxyGroupsText: string;
  clashRulesText: string;
  clashDnsText: string;
  jsonBalancersText: string;
  jsonRoutingRulesText: string;
  jsonObservatoryText: string;
  jsonDnsText: string;
};

type PreviewState = {
  output: string;
  contentType: string;
  conversion: string;
  servers: string[];
  body: string;
  bodyBytes: number;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const trimmed = String(value || "").trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} должен быть JSON-объектом`);
  }
  return parsed as Record<string, unknown>;
}

function parseJsonArray(value: string, label: string): unknown[] {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} должен быть JSON-массивом`);
  }
  return parsed;
}

function parseLineList(value: string): string[] {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readDraftsFromOverrides(overrides: Record<string, unknown>): DraftState {
  const nodes = asObject(overrides.nodes);
  const topology = asObject(overrides.topology);
  const policy = asObject(overrides.policy);
  const proxyGroups = asObject(topology.proxyGroups);
  const balancers = asObject(topology.balancers);
  const clashRules = asObject(policy.rules);
  const routingRules = asObject(policy.routingRules);

  return {
    nodesByNameText: prettyJson(asObject(nodes.byName)),
    disabledIdsText: Array.isArray(nodes.disabledIds) ? nodes.disabledIds.map((entry) => String(entry || "")).filter(Boolean).join("\n") : "",
    clashProxyGroupsText: prettyJson(asObject(proxyGroups.byName)),
    clashRulesText: Array.isArray(clashRules.replace) ? clashRules.replace.map((entry) => String(entry || "")).join("\n") : "",
    clashDnsText: prettyJson(asObject(policy.dns)),
    jsonBalancersText: prettyJson(asObject(balancers.byTag)),
    jsonRoutingRulesText: prettyJson(Array.isArray(routingRules.replace) ? routingRules.replace : []),
    jsonObservatoryText: prettyJson(asObject(topology.observatory)),
    jsonDnsText: prettyJson(asObject(policy.dns)),
  };
}

function editorModeFromItem(item: FavoriteItem): EditorMode {
  const output = String(item.payload.output || "").trim().toLowerCase();
  if (output === "json") return "json";
  if (output === "yml" || output === "yaml" || output === "clash") return "clash";
  return "raw";
}

function removeEmptyBranch(target: Record<string, unknown>, key: string) {
  const branch = asObject(target[key]);
  if (Object.keys(branch).length === 0) delete target[key];
}

function composeOverrides(base: Record<string, unknown>, drafts: DraftState, mode: EditorMode): Record<string, unknown> {
  const next = cloneJson(base || {});
  const nodes = asObject(next.nodes);
  const topology = asObject(next.topology);
  const policy = asObject(next.policy);

  const nodesByName = parseJsonObject(drafts.nodesByNameText, "nodes.byName");
  const disabledIds = parseLineList(drafts.disabledIdsText);
  if (Object.keys(nodesByName).length > 0) nodes.byName = nodesByName;
  else delete nodes.byName;
  if (disabledIds.length > 0) nodes.disabledIds = disabledIds;
  else delete nodes.disabledIds;
  if (Object.keys(nodes).length > 0) next.nodes = nodes;
  else delete next.nodes;

  if (mode === "clash") {
    const proxyGroups = asObject(topology.proxyGroups);
    const proxyGroupsByName = parseJsonObject(drafts.clashProxyGroupsText, "topology.proxyGroups.byName");
    if (Object.keys(proxyGroupsByName).length > 0) proxyGroups.byName = proxyGroupsByName;
    else delete proxyGroups.byName;
    if (Object.keys(proxyGroups).length > 0) topology.proxyGroups = proxyGroups;
    else delete topology.proxyGroups;

    const clashRules = parseLineList(drafts.clashRulesText);
    if (clashRules.length > 0) policy.rules = { ...asObject(policy.rules), replace: clashRules };
    else delete policy.rules;

    const dns = parseJsonObject(drafts.clashDnsText, "policy.dns");
    if (Object.keys(dns).length > 0) policy.dns = dns;
    else delete policy.dns;
  }

  if (mode === "json") {
    const balancers = asObject(topology.balancers);
    const balancersByTag = parseJsonObject(drafts.jsonBalancersText, "topology.balancers.byTag");
    if (Object.keys(balancersByTag).length > 0) balancers.byTag = balancersByTag;
    else delete balancers.byTag;
    if (Object.keys(balancers).length > 0) topology.balancers = balancers;
    else delete topology.balancers;

    const observatory = parseJsonObject(drafts.jsonObservatoryText, "topology.observatory");
    if (Object.keys(observatory).length > 0) topology.observatory = observatory;
    else delete topology.observatory;

    const routingRules = parseJsonArray(drafts.jsonRoutingRulesText, "policy.routingRules.replace");
    if (routingRules.length > 0) policy.routingRules = { ...asObject(policy.routingRules), replace: routingRules };
    else delete policy.routingRules;

    const dns = parseJsonObject(drafts.jsonDnsText, "policy.dns");
    if (Object.keys(dns).length > 0) policy.dns = dns;
    else delete policy.dns;
  }

  removeEmptyBranch(topology, "proxyGroups");
  removeEmptyBranch(topology, "balancers");
  if (Object.keys(topology).length > 0) next.topology = topology;
  else delete next.topology;

  if (Object.keys(policy).length > 0) next.policy = policy;
  else delete next.policy;

  return next;
}

export function OverridesModal({ item, onClose, onNotify }: Props) {
  const mode = useMemo(() => editorModeFromItem(item), [item]);
  const [loading, setLoading] = useState(false);
  const [overrideVersion, setOverrideVersion] = useState(0);
  const [baseOverrides, setBaseOverrides] = useState<Record<string, unknown>>({});
  const [drafts, setDrafts] = useState<DraftState>({
    nodesByNameText: "{}",
    disabledIdsText: "",
    clashProxyGroupsText: "{}",
    clashRulesText: "",
    clashDnsText: "{}",
    jsonBalancersText: "{}",
    jsonRoutingRulesText: "[]",
    jsonObservatoryText: "{}",
    jsonDnsText: "{}",
  });
  const [jsonText, setJsonText] = useState("{}");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!item.shortId) return undefined;
    setLoading(true);
    setOverrideVersion(0);
    setBaseOverrides({});
    setDrafts({
      nodesByNameText: "{}",
      disabledIdsText: "",
      clashProxyGroupsText: "{}",
      clashRulesText: "",
      clashDnsText: "{}",
      jsonBalancersText: "{}",
      jsonRoutingRulesText: "[]",
      jsonObservatoryText: "{}",
      jsonDnsText: "{}",
    });
    setJsonText("{}");
    setPreview(null);
    void fetchShortLinkOverrides(item.shortId)
      .then((data) => {
        if (cancelled) return;
        const overrides = data.overrides || {};
        setBaseOverrides(overrides);
        setDrafts(readDraftsFromOverrides(overrides));
        setOverrideVersion(data.overrideVersion || 0);
      })
      .catch((e) => {
        if (cancelled) return;
        onNotify("error", (e as Error)?.message || "Не удалось загрузить overrides");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, onNotify]);

  useEffect(() => {
    try {
      setJsonText(prettyJson(composeOverrides(baseOverrides, drafts, mode)));
    } catch {
      // Keep the last valid JSON view while the user edits structured fields.
    }
  }, [baseOverrides, drafts, mode]);

  const applyJsonToStructuredDrafts = () => {
    try {
      const parsed = parseJsonObject(jsonText, "Overrides JSON");
      setBaseOverrides(parsed);
      setDrafts(readDraftsFromOverrides(parsed));
      onNotify("info", "JSON применен к форме");
    } catch (e) {
      onNotify("error", (e as Error)?.message || "Некорректный JSON");
    }
  };

  const saveOverrides = async () => {
    if (!item.shortId) return;
    let nextOverrides: Record<string, unknown>;
    try {
      nextOverrides = composeOverrides(baseOverrides, drafts, mode);
      setJsonText(prettyJson(nextOverrides));
    } catch (e) {
      onNotify("error", (e as Error)?.message || "Некорректные overrides");
      return;
    }
    try {
      setLoading(true);
      const saved = await updateShortLinkOverrides(item.shortId, nextOverrides);
      setBaseOverrides(nextOverrides);
      setOverrideVersion(saved.overrideVersion || 0);
      onNotify("success", "Overrides сохранены");
    } catch (e) {
      onNotify("error", (e as Error)?.message || "Не удалось сохранить overrides");
    } finally {
      setLoading(false);
    }
  };

  const resetStructuredDrafts = () => {
    setBaseOverrides({});
    setDrafts(readDraftsFromOverrides({}));
    setPreview(null);
    onNotify("info", "Форма overrides очищена");
  };

  const renderPreview = async () => {
    if (!item.shortId) return;
    let nextOverrides: Record<string, unknown>;
    try {
      nextOverrides = composeOverrides(baseOverrides, drafts, mode);
      setJsonText(prettyJson(nextOverrides));
    } catch (e) {
      onNotify("error", (e as Error)?.message || "Некорректные overrides");
      return;
    }
    try {
      setPreviewLoading(true);
      const data = await previewShortLinkOverrides(item.shortId, nextOverrides);
      setPreview(data);
      onNotify("success", "Превью обновлено");
    } catch (e) {
      onNotify("error", (e as Error)?.message || "Не удалось построить превью");
    } finally {
      setPreviewLoading(false);
    }
  };

  const formatTitle = mode === "json" ? "json" : (mode === "clash" ? "clash/yml" : "raw");

  return (
    <Modal onClose={onClose} title={`Overrides: ${item.title}`} showCloseButton>
      <div className="status">
        Режим редактора: {formatTitle}. Overrides сохраняются во внутреннем формате и применяются перед рендером ответа.
      </div>
      <div className="status">
        Версия: {overrideVersion} {loading ? "· загрузка..." : ""}
      </div>

      <section className="overrides-layout">
        <div className="overrides-pane">
          <h3 className="editor-heading">Узлы</h3>
          <label className="composer-label">`nodes.byName` (JSON)</label>
          <Textarea
            rows={8}
            value={drafts.nodesByNameText}
            onChange={(e) => setDrafts((prev) => ({ ...prev, nodesByNameText: e.target.value }))}
            placeholder={`{\n  "Node name": {\n    "name": "Renamed node",\n    "host": "example.com",\n    "port": 443,\n    "enabled": true\n  }\n}`}
          />
          <label className="composer-label">`nodes.disabledIds` (по одному id на строку)</label>
          <Textarea
            rows={4}
            value={drafts.disabledIdsText}
            onChange={(e) => setDrafts((prev) => ({ ...prev, disabledIdsText: e.target.value }))}
            placeholder="node-0001&#10;node-0002"
          />
        </div>

        {mode === "clash" ? (
          <div className="overrides-pane">
            <h3 className="editor-heading">Clash</h3>
            <label className="composer-label">`topology.proxyGroups.byName` (JSON)</label>
            <Textarea
              rows={8}
              value={drafts.clashProxyGroupsText}
              onChange={(e) => setDrafts((prev) => ({ ...prev, clashProxyGroupsText: e.target.value }))}
              placeholder={`{\n  "AUTO": {\n    "type": "select",\n    "proxies": ["Node A", "Node B"]\n  }\n}`}
            />
            <label className="composer-label">`policy.rules.replace` (по одному правилу на строку)</label>
            <Textarea
              rows={6}
              value={drafts.clashRulesText}
              onChange={(e) => setDrafts((prev) => ({ ...prev, clashRulesText: e.target.value }))}
              placeholder="DOMAIN-SUFFIX,example.com,PROXY&#10;MATCH,DIRECT"
            />
            <label className="composer-label">`policy.dns` (JSON)</label>
            <Textarea
              rows={6}
              value={drafts.clashDnsText}
              onChange={(e) => setDrafts((prev) => ({ ...prev, clashDnsText: e.target.value }))}
              placeholder={`{\n  "enable": true,\n  "nameserver": ["1.1.1.1", "8.8.8.8"]\n}`}
            />
          </div>
        ) : null}

        {mode === "json" ? (
          <div className="overrides-pane">
            <h3 className="editor-heading">JSON / Xray</h3>
            <label className="composer-label">`topology.balancers.byTag` (JSON)</label>
            <Textarea
              rows={7}
              value={drafts.jsonBalancersText}
              onChange={(e) => setDrafts((prev) => ({ ...prev, jsonBalancersText: e.target.value }))}
              placeholder={`{\n  "bal_26": {\n    "selector": ["grp-26-1"],\n    "fallbackTag": "grp-26-2"\n  }\n}`}
            />
            <label className="composer-label">`policy.routingRules.replace` (JSON массив)</label>
            <Textarea
              rows={7}
              value={drafts.jsonRoutingRulesText}
              onChange={(e) => setDrafts((prev) => ({ ...prev, jsonRoutingRulesText: e.target.value }))}
              placeholder={`[\n  {\n    "type": "field",\n    "domain": ["example.com"],\n    "outboundTag": "direct"\n  }\n]`}
            />
            <label className="composer-label">`topology.observatory` (JSON)</label>
            <Textarea
              rows={5}
              value={drafts.jsonObservatoryText}
              onChange={(e) => setDrafts((prev) => ({ ...prev, jsonObservatoryText: e.target.value }))}
              placeholder={`{\n  "probeUrl": "https://www.gstatic.com/generate_204"\n}`}
            />
            <label className="composer-label">`policy.dns` (JSON)</label>
            <Textarea
              rows={5}
              value={drafts.jsonDnsText}
              onChange={(e) => setDrafts((prev) => ({ ...prev, jsonDnsText: e.target.value }))}
              placeholder={`{\n  "servers": ["1.1.1.1", "8.8.8.8"]\n}`}
            />
          </div>
        ) : null}

        <div className="overrides-pane">
          <h3 className="editor-heading">JSON Fallback</h3>
          <div className="composer-meta-hint">
            Debug-режим: можно редактировать весь объект overrides вручную. После изменения нажми "Применить JSON в форму".
          </div>
          <Textarea
            rows={18}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="{}"
          />
          <div className="toolbar">
            <Button className="btn" onClick={applyJsonToStructuredDrafts}>Применить JSON в форму</Button>
            <Button className="btn" onClick={resetStructuredDrafts}>Очистить форму</Button>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <Button className="btn" tone="primary" onClick={() => void saveOverrides()}>
          Сохранить overrides
        </Button>
        <Button className="btn" onClick={() => void renderPreview()}>
          {previewLoading ? "Обновление превью..." : "Показать превью"}
        </Button>
      </div>

      {preview ? (
        <section className="overrides-preview">
          <div className="sub-head">
            <div>
              <div className="sub-name">Превью результата</div>
              <div className="composer-meta-hint">
                {preview.output} · {preview.contentType || "unknown"} · {preview.conversion || "n/a"} · {preview.bodyBytes} bytes
              </div>
            </div>
          </div>
          <label className="composer-label">Серверы</label>
          <Textarea
            rows={Math.min(Math.max(preview.servers.length || 1, 3), 8)}
            readOnly
            value={preview.servers.length > 0 ? preview.servers.join("\n") : "Серверы не распознаны"}
          />
          <label className="composer-label">Тело результата</label>
          <Textarea rows={18} readOnly value={preview.body} />
        </section>
      ) : null}
    </Modal>
  );
}
