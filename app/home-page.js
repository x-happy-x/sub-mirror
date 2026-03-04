import fs from "node:fs";
import path from "node:path";
import { PROFILE_ROOT_DIRS } from "./config.js";

function escapeHtmlAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function listAvailableProfiles() {
  const profileSet = new Set();
  const seenDirs = new Set();

  for (const root of PROFILE_ROOT_DIRS) {
    for (const dir of [path.join(root, "profiles"), path.join(root, "base"), root]) {
      if (seenDirs.has(dir)) continue;
      seenDirs.add(dir);
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const m = entry.name.match(/^(.+)\.(yml|yaml)$/i);
        if (!m) continue;
        const profileName = m[1];
        profileSet.add(profileName);
      }
    }
  }

  return {
    base: Array.from(profileSet).sort(),
    ua: [],
  };
}

function renderHomePage() {
  const profileCatalog = listAvailableProfiles();
  const baseChips = profileCatalog.base
    .map(
      (name) =>
        `<button type="button" class="chip chip-check" data-profile="${escapeHtmlAttr(name)}">${escapeHtmlAttr(name)}</button>`,
    )
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sub Mirror Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f7f5f2;
      --ink: #191817;
      --muted: #6f6a64;
      --line: #e3ddd6;
      --card: #ffffff;
      --card-2: #fbf9f6;
      --accent: #d97757;
      --accent-2: #b65f44;
      --danger: #a9342f;
      --ok: #2f7a4f;
      --shadow: 0 12px 30px rgba(41, 32, 26, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: "Plus Jakarta Sans", "IBM Plex Sans", "Segoe UI", sans-serif;
      background: var(--bg);
      padding: 22px 14px 36px;
    }
    .page {
      max-width: 1160px;
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }
    .hero {
      margin-top: 33vh;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-mark {
      width: 54px;
      height: 54px;
      flex: 0 0 auto;
    }
    h1 { margin: 0; font-size: 30px; letter-spacing: -.02em; }
    .subtitle { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
    .top-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .cards {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr;
    }
    .bottom-chip-row {
      display: flex;
      justify-content: center;
      gap: 8px;
      padding: 2px 0 4px;
    }
    .sub-card {
      border: 1px solid var(--line);
      background: var(--card);
      border-radius: 16px;
      box-shadow: var(--shadow);
      padding: 14px;
    }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      border-radius: 12px;
      padding: 10px 13px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .icon-btn {
      width: 34px;
      height: 34px;
      padding: 0;
      border-radius: 10px;
    }
    .btn:hover { filter: brightness(0.99); }
    .btn-primary {
      color: #fff;
      border-color: transparent;
      background: linear-gradient(120deg, var(--accent), var(--accent-2));
    }
    .btn-danger {
      background: #fff1f5;
      border-color: #e9c0bf;
      color: var(--danger);
    }
    .btn-happ {
      background: #f4f1ec;
      border-color: #ded6cd;
      color: #4e4842;
    }
    .btn-fl {
      background: #f4f1ec;
      border-color: #ded6cd;
      color: #4e4842;
    }
    .btn-icon {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
    }

    .sub-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .sub-name { font-size: 16px; font-weight: 700; }
    .sub-url {
      font-family: "IBM Plex Mono", monospace;
      color: #3f5e83;
      font-size: 12px;
      line-height: 1.35;
      word-break: break-all;
      margin-bottom: 8px;
    }
    .labels { display: flex; flex-wrap: wrap; gap: 6px; }
    .label {
      border: 1px solid #d0deec;
      background: #f8fbff;
      color: #2f5072;
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 11px;
      font-weight: 600;
    }

    .composer {
      position: fixed;
      inset: 0;
      z-index: 70;
      background: var(--bg);
      padding: 16px 14px 28px;
      display: none;
      overflow: auto;
      gap: 12px;
    }
    .composer.open { display: grid; }
    .composer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .composer-title { margin: 0; font-size: 20px; }

    .block {
      border: 1px solid var(--line);
      background: var(--card-2);
      border-radius: 14px;
      padding: 12px;
    }
    .block-title {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 700;
      color: #335479;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .full { grid-column: 1 / -1; }
    label {
      display: block;
      margin-bottom: 6px;
      color: #35577d;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    input[type="text"], select, textarea {
      width: 100%;
      border: 1px solid #c7d9ec;
      background: #fff;
      color: var(--ink);
      border-radius: 11px;
      padding: 9px 11px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    textarea {
      resize: vertical;
      min-height: 92px;
      font-family: "IBM Plex Mono", monospace;
      font-size: 12px;
    }
    input[type="text"]:focus, select:focus, textarea:focus {
      border-color: #73a8df;
      box-shadow: 0 0 0 3px rgba(98, 157, 214, 0.2);
    }
    .hint {
      margin-top: 5px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .chip-row { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip {
      border: 1px solid #c2d7ee;
      background: #fff;
      color: #28496c;
      border-radius: 999px;
      padding: 8px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .chip.active {
      color: #fff;
      border-color: transparent;
      background: linear-gradient(120deg, var(--accent), var(--accent-2));
    }

    .result {
      border: 1px solid #c6d9ed;
      background: #fff;
      border-radius: 12px;
      padding: 10px;
      min-height: 42px;
      font-size: 12px;
      line-height: 1.4;
      word-break: break-all;
      font-family: "IBM Plex Mono", monospace;
    }
    .status {
      min-height: 18px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .status.warn { color: #9c6400; }
    .status.error { color: var(--danger); }
    .status.ok { color: var(--ok); }

    .qr {
      margin-top: 10px;
      min-height: 220px;
      border: 1px dashed #bdd2e8;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: #fff;
      padding: 10px;
    }
    .qr img {
      width: 200px;
      height: 200px;
      background: #fff;
      border-radius: 10px;
      padding: 8px;
      border: 1px solid #ecf2f9;
    }

    .logs-box {
      border: 1px solid #c6d9ed;
      background: #fff;
      border-radius: 12px;
      min-height: 150px;
      max-height: 340px;
      overflow: auto;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      font-family: "IBM Plex Mono", monospace;
    }
    details {
      border: 1px solid #e1d9d0;
      border-radius: 10px;
      background: #fff;
      padding: 8px;
      margin-top: 8px;
    }
    details > summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      color: #4d4a46;
      user-select: none;
    }
    details .logs-box {
      margin-top: 8px;
    }

    .modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(20, 46, 77, 0.45);
      z-index: 50;
      padding: 16px;
    }
    .modal.open { display: flex; }
    .modal-box {
      width: min(760px, 100%);
      border: 1px solid #c5d9ee;
      border-radius: 14px;
      background: #fff;
      padding: 14px;
      box-shadow: var(--shadow);
    }
    .modal-row {
      margin-top: 8px;
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
      align-items: center;
    }
    .share-screen {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: none;
      background: var(--bg);
      overflow: auto;
      padding: 16px 14px 28px;
    }
    .share-screen.open { display: block; }
    .share-wrap {
      max-width: 900px;
      margin: 0 auto;
      display: grid;
      gap: 12px;
    }
    .share-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .share-title { margin: 0; font-size: 22px; }
    .share-apps {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .share-link-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .share-qr { margin-top: 4px; }
    .share-screen .qr img {
      width: min(100%, 360px);
      height: auto;
      aspect-ratio: 1 / 1;
    }
    .back-icon-btn {
      width: 38px;
      height: 38px;
      padding: 0;
      border-radius: 10px;
    }
    .mock-screen {
      position: fixed;
      inset: 0;
      z-index: 75;
      display: none;
      background: var(--bg);
      overflow: auto;
      padding: 16px 14px 28px;
    }
    .mock-screen.open { display: block; }
    .profile-screen {
      position: fixed;
      inset: 0;
      z-index: 76;
      display: none;
      background: var(--bg);
      overflow: auto;
      padding: 16px 14px 28px;
    }
    .profile-screen.open { display: block; }
    .test-screen {
      position: fixed;
      inset: 0;
      z-index: 77;
      display: none;
      background: var(--bg);
      overflow: auto;
      padding: 16px 14px 28px;
    }
    .test-screen.open { display: block; }

    .hidden { display: none !important; }

    @media (max-width: 980px) {
      .hero { margin-top: 26vh; }
      .top-actions { grid-template-columns: 1fr 1fr; }
      .share-apps, .share-link-actions { grid-template-columns: 1fr 1fr; }
      .share-screen .qr img { width: 100%; max-width: none; }
      .fields { grid-template-columns: 1fr; }
      .modal-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <svg class="brand-mark" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#g1)"/>
        <path d="M18 23h28v5H18zM18 31h20v5H18zM18 39h28v5H18z" fill="#fff"/>
        <defs>
          <linearGradient id="g1" x1="8" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
            <stop stop-color="#E08C65"/>
            <stop offset="1" stop-color="#B65F44"/>
          </linearGradient>
        </defs>
      </svg>
      <div>
        <h1>SubLab</h1>
        <p class="subtitle">Лаборатория подписок</p>
        <span style="display:none">Sub Mirror</span>
      </div>
    </section>

    <section class="top-actions" id="quickLaunch">
      <button type="button" id="openImportModal" class="btn">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Импорт подписки
      </button>
      <button type="button" id="openComposerAdd" class="btn btn-primary">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        Добавить подписку
      </button>
    </section>

    <section class="cards" id="cardsRoot">
      <div id="savedCards"></div>
    </section>

    <section class="bottom-chip-row">
      <button id="openMockStudioChip" class="chip" type="button">Тестовый сервер</button>
      <button id="openProfileEditorChip" class="chip" type="button">Редактор профилей и UA</button>
      <button id="openSubTestChip" class="chip" type="button">Тест подписки</button>
    </section>

    <section id="composer" class="composer">
      <div class="composer-head">
        <h2 class="composer-title">Конструктор подписки</h2>
        <div class="toolbar">
          <button id="closeComposer" class="btn">Закрыть</button>
        </div>
      </div>

      <section class="block">
        <h3 class="block-title">Шаг 1: Источник</h3>
        <div class="chip-row" id="sourceModeChips" style="margin-bottom:8px;">
          <button type="button" class="chip active" data-value="real">Реальная подписка</button>
          <button type="button" class="chip" data-value="test">Тестовый сервер</button>
        </div>

        <div id="realSourceWrap" class="fields">
          <div class="full">
            <label for="sub_url">sub_url</label>
            <input id="sub_url" type="text" placeholder="https://example.com/sub" />
            <div class="hint">URL реального источника подписки.</div>
          </div>
        </div>

        <div id="testSourceWrap" class="fields hidden">
          <div class="full">
            <label>URL тестового сервера</label>
            <div id="mockSourcePreview" class="result">URL не задан. Открой студию тестового сервера.</div>
            <div class="hint">Источник задается в отдельной fullscreen-студии.</div>
          </div>
          <div class="full toolbar">
            <button id="openMockStudioFromComposer" class="btn btn-primary">Открыть студию тестового сервера</button>
          </div>
        </div>
      </section>

      <section id="paramsSection" class="block hidden">
        <h3 class="block-title">Шаг 2: Параметры подписки</h3>
        <div class="fields">
          <div class="full">
            <label>Режим запроса</label>
            <input id="endpoint" type="hidden" value="last" />
            <button type="button" id="cacheToggle" class="chip active">Кэшировать подписку</button>
            <div class="hint">Включено: <code>/last</code>. Выключено: <code>/sub</code>.</div>
          </div>

          <div class="full">
            <label for="sub_name">Название подписки</label>
            <input id="sub_name" type="text" placeholder="Например: Основная / iPhone" />
          </div>

          <div>
            <label>output</label>
            <input id="output" type="hidden" value="yml" />
            <div id="outputChips" class="chip-row">
              <button type="button" class="chip active" data-value="yml">yml / clash</button>
              <button type="button" class="chip" data-value="raw">raw</button>
            </div>
          </div>

          <div>
            <label>app</label>
            <input id="app" type="hidden" value="flclashx" />
            <div id="appChips" class="chip-row">
              <button type="button" class="chip active" data-value="flclashx">flclashx</button>
              <button type="button" class="chip" data-value="happ">happ</button>
              <button type="button" class="chip" data-value="">не указывать</button>
            </div>
          </div>

          <div class="full">
            <label>Профили (base)</label>
            <input id="profile" type="hidden" value="" />
            <input id="profiles" type="hidden" value="" />
            <div id="baseProfileChecks" class="chip-row">${baseChips || "<span style=\"color:var(--muted);font-size:12px;\">Нет профилей</span>"}</div>
            <div class="hint">Выберите один или несколько профилей.</div>
          </div>

          <div>
            <label>device</label>
            <input id="device" type="hidden" value="android" />
            <div id="deviceChips" class="chip-row">
              <button type="button" class="chip active" data-value="android">android</button>
              <button type="button" class="chip" data-value="windows">windows</button>
              <button type="button" class="chip" data-value="ios">ios</button>
              <button type="button" class="chip" data-value="linux">linux</button>
              <button type="button" class="chip" data-value="">не указывать</button>
            </div>
          </div>

          <div>
            <label for="hwid">hwid</label>
            <input id="hwid" type="text" placeholder="device-hwid" />
          </div>
        </div>
      </section>

      <section id="saveActionsSection" class="block hidden">
        <h3 class="block-title">Действия</h3>
        <div id="composerStatus" class="status"></div>
        <div class="toolbar" style="margin-top:8px;">
          <button id="saveSubscription" class="btn btn-primary">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M12 5v14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Сохранить
          </button>
          <button id="saveAsSubscription" class="btn">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M12 5v14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Сохранить как
          </button>
        </div>
      </section>

      <div class="hidden">
        <button id="openHapp" type="button">happ</button>
        <button id="openFl" type="button">fl</button>
      </div>

    </section>
  </main>

  <section id="mockScreen" class="mock-screen" aria-hidden="true">
    <div class="share-wrap">
      <div class="share-head">
        <h2 class="share-title">Тестовый сервер</h2>
        <button id="closeMockScreen" class="btn back-icon-btn" aria-label="Вернуться" title="Вернуться">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <article class="sub-card">
        <div class="fields">
          <div class="full">
            <label for="mockSourceUrl">URL тестового сервера</label>
            <input id="mockSourceUrl" type="text" placeholder="http://localhost:25500/mock/abc123" />
          </div>
          <div>
            <label for="mockPreset">Preset</label>
            <select id="mockPreset">
              <option value="stub_raw">stub_raw (подписки)</option>
              <option value="stub_clash">stub_clash (yaml)</option>
              <option value="no_subscriptions">no_subscriptions</option>
              <option value="antibot_html">antibot_html</option>
            </select>
          </div>
          <div>
            <label for="mockStatus">HTTP статус</label>
            <input id="mockStatus" type="text" value="200" />
          </div>
          <div>
            <label for="mockContentType">Content-Type</label>
            <input id="mockContentType" type="text" value="text/plain; charset=utf-8" />
          </div>
          <div>
            <label for="mockDelayMs">Delay (ms)</label>
            <input id="mockDelayMs" type="text" value="0" />
          </div>
          <div class="full">
            <label for="mockHeaders">Доп. заголовки (JSON)</label>
            <textarea id="mockHeaders" placeholder='{"x-debug":"demo"}'></textarea>
          </div>
          <div class="full">
            <label for="mockBody">Тело ответа</label>
            <textarea id="mockBody" placeholder="response body"></textarea>
          </div>
        </div>
        <div class="toolbar">
          <button id="mockLoad" class="btn">Загрузить mock</button>
          <button id="mockCreate" class="btn btn-primary">Создать mock</button>
          <button id="mockUpdate" class="btn">Обновить mock</button>
          <button id="mockRefreshLogs" class="btn">Обновить логи</button>
          <button id="mockClearLogs" class="btn btn-danger">Очистить логи</button>
          <button id="mockUseAsSubUrl" class="btn">Использовать этот тестовый URL</button>
        </div>
      </article>

      <article class="sub-card">
        <label style="margin-top:12px;">Логи тестового сервера</label>
        <div id="mockLogs" class="logs-box">Логов пока нет</div>
      </article>
    </div>
  </section>

  <section id="profileEditorScreen" class="profile-screen" aria-hidden="true">
    <div class="share-wrap">
      <div class="share-head">
        <h2 class="share-title">Редактор профилей и UA</h2>
        <button id="closeProfileEditorScreen" class="btn back-icon-btn" aria-label="Вернуться" title="Вернуться">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <article class="sub-card">
        <div class="fields">
          <div>
            <label for="profileEditorKind">Тип</label>
            <select id="profileEditorKind">
              <option value="base">base</option>
              <option value="ua">ua</option>
            </select>
          </div>
          <div>
            <label for="profileEditorName">Профиль</label>
            <input id="profileEditorName" type="text" placeholder="например: iphone или ua-default" />
          </div>
          <div class="full">
            <label for="profileEditorList">Список профилей</label>
            <select id="profileEditorList"></select>
          </div>
          <div class="full">
            <label for="profileEditorContent">Содержимое YAML</label>
            <textarea id="profileEditorContent" placeholder="sub_url: ..."></textarea>
          </div>
        </div>
        <div id="profileEditorStatus" class="status"></div>
        <div class="toolbar">
          <button id="profileEditorNew" class="btn">Новый</button>
          <button id="profileEditorLoad" class="btn">Загрузить</button>
          <button id="profileEditorSave" class="btn btn-primary">Сохранить</button>
          <button id="profileEditorDelete" class="btn btn-danger">Удалить</button>
        </div>
      </article>
    </div>
  </section>

  <section id="subTestScreen" class="test-screen" aria-hidden="true">
    <div class="share-wrap">
      <div class="share-head">
        <h2 class="share-title">Тестирование подписки</h2>
        <button id="closeSubTestScreen" class="btn back-icon-btn" aria-label="Вернуться" title="Вернуться">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <article class="sub-card">
        <div class="fields">
          <div class="full">
            <label for="subTestSavedSelect">Тестер сохраненных подписок</label>
            <select id="subTestSavedSelect"></select>
          </div>
        </div>
        <div class="toolbar" style="margin-top:8px;">
          <button id="subTestSavedRefresh" class="btn">Обновить список</button>
          <button id="subTestSavedApply" class="btn">Подставить в тестер</button>
          <button id="subTestSavedRun" class="btn btn-primary">Проверить сохраненную</button>
        </div>
      </article>

      <article class="sub-card">
        <div class="fields">
          <div class="full">
            <label for="subTestSubUrl">sub_url</label>
            <input id="subTestSubUrl" type="text" placeholder="https://example.com/sub" />
          </div>
          <div>
            <label for="subTestEndpoint">endpoint</label>
            <select id="subTestEndpoint">
              <option value="last">last (кэш)</option>
              <option value="sub">sub (без кэша)</option>
            </select>
          </div>
          <div>
            <label for="subTestOutput">output</label>
            <select id="subTestOutput">
              <option value="yml">yml / clash</option>
              <option value="raw">raw</option>
            </select>
          </div>
          <div>
            <label for="subTestApp">app</label>
            <input id="subTestApp" type="text" placeholder="flclashx" />
          </div>
          <div>
            <label for="subTestDevice">device</label>
            <input id="subTestDevice" type="text" placeholder="android" />
          </div>
          <div>
            <label for="subTestProfile">profile</label>
            <select id="subTestProfile"></select>
          </div>
          <div class="full">
            <label>profiles (дополнительно)</label>
            <input id="subTestProfiles" type="hidden" value="" />
            <div id="subTestProfilesChecks" class="chip-row"></div>
          </div>
          <div>
            <label for="subTestHwid">hwid</label>
            <input id="subTestHwid" type="text" placeholder="device-hwid" />
          </div>
          <div class="full">
            <label for="subTestHeaders">Доп. заголовки (JSON)</label>
            <textarea id="subTestHeaders" placeholder='{"x-debug":"1"}'></textarea>
          </div>
        </div>
        <div id="subTestStatus" class="status"></div>
        <div class="toolbar">
          <button id="subTestFillFromComposer" class="btn">Взять из конструктора</button>
          <button id="subTestRun" class="btn btn-primary">Запустить тест</button>
        </div>
      </article>

      <article class="sub-card">
        <div class="fields">
          <div class="full">
            <label>Что вернул запрос</label>
            <div id="subTestResponseInfo" class="result">Запустите тест для диагностики.</div>
          </div>
          <div>
            <label>Формат источника</label>
            <div id="subTestSourceFormat" class="result">-</div>
          </div>
          <div>
            <label>Формат после конвертации</label>
            <div id="subTestConvertedFormat" class="result">-</div>
          </div>
          <div>
            <label for="subTestSourceServers" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span>Серверы в ответе источника</span>
              <button id="subTestCopySourceBody" class="btn icon-btn" type="button" title="Копировать исходный ответ" aria-label="Копировать исходный ответ">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                </svg>
              </button>
            </label>
            <select id="subTestSourceServers"></select>
          </div>
          <div>
            <label for="subTestConvertedServers" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span>Серверы после конвертации</span>
              <button id="subTestCopyConvertedBody" class="btn icon-btn" type="button" title="Копировать результат конвертации" aria-label="Копировать результат конвертации">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                </svg>
              </button>
            </label>
            <select id="subTestConvertedServers"></select>
          </div>
        </div>
      </article>

      <article class="sub-card">
        <label>JSON диагностика</label>
        <details open>
          <summary>Запрос / ответ</summary>
          <div id="subTestRequestResult" class="logs-box">Нет данных.</div>
        </details>
        <details>
          <summary>Заголовки</summary>
          <div id="subTestHeadersResult" class="logs-box">Нет данных.</div>
        </details>
        <details>
          <summary>Кэш и конвертация</summary>
          <div id="subTestCacheResult" class="logs-box">Нет данных.</div>
        </details>
      </article>
    </div>
  </section>

  <div id="importModal" class="modal" role="dialog" aria-modal="true">
    <div class="modal-box">
      <label for="import_link">Импорт из ссылки</label>
      <div class="hint">Вставьте готовую ссылку /sub, /last, /l/&lt;id&gt; или /mock/&lt;id&gt;.</div>
      <div class="modal-row">
        <input id="import_link" type="text" placeholder="http://localhost:25500/last?app=..." />
        <button id="importApply" class="btn btn-primary">Применить</button>
        <button id="importClose" class="btn">Закрыть</button>
      </div>
    </div>
  </div>

  <section id="shareScreen" class="share-screen" aria-hidden="true">
    <div class="share-wrap">
      <div class="share-head">
        <h2 id="shareCardTitle" class="share-title">Поделиться подпиской</h2>
        <button id="closeShareScreen" class="btn back-icon-btn" aria-label="Вернуться" title="Вернуться">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="share-apps">
        <button id="shareOpenHapp" class="btn btn-happ">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          Happ
        </button>
        <button id="shareOpenFl" class="btn btn-fl">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          FlClashX
        </button>
      </div>

      <div class="share-link-actions">
        <button id="shareCopyFull" class="btn">Полная ссылка</button>
        <button id="shareCopyShort" class="btn">Короткая ссылка</button>
      </div>

      <div id="shareQrWrap" class="qr share-qr"></div>
    </div>
  </section>

  <script>
    const qs = (id) => document.getElementById(id);
    const fields = ["sub_url", "endpoint", "output", "app", "device", "profile", "profiles", "hwid"];
    const state = {};
    for (const key of fields) state[key] = qs(key);

    const composer = qs("composer");
    const paramsSection = qs("paramsSection");
    const saveActionsSection = qs("saveActionsSection");
    const realSourceWrap = qs("realSourceWrap");
    const testSourceWrap = qs("testSourceWrap");
    const mockSourcePreviewEl = qs("mockSourcePreview");
    const savedCardsEl = qs("savedCards");

    const statusEl = qs("composerStatus");

    const subNameEl = qs("sub_name");
    const mockSourceUrlEl = qs("mockSourceUrl");
    const mockPresetEl = qs("mockPreset");
    const mockStatusEl = qs("mockStatus");
    const mockContentTypeEl = qs("mockContentType");
    const mockDelayMsEl = qs("mockDelayMs");
    const mockHeadersEl = qs("mockHeaders");
    const mockBodyEl = qs("mockBody");
    const mockLogsEl = qs("mockLogs");

    const importModal = qs("importModal");
    const importInput = qs("import_link");
    const mockScreen = qs("mockScreen");
    const profileEditorScreen = qs("profileEditorScreen");
    const subTestScreen = qs("subTestScreen");
    const shareScreen = qs("shareScreen");
    const shareCardTitle = qs("shareCardTitle");
    const shareQrWrap = qs("shareQrWrap");
    const profileEditorKindEl = qs("profileEditorKind");
    const profileEditorNameEl = qs("profileEditorName");
    const profileEditorListEl = qs("profileEditorList");
    const profileEditorContentEl = qs("profileEditorContent");
    const profileEditorStatusEl = qs("profileEditorStatus");
    const subTestSubUrlEl = qs("subTestSubUrl");
    const subTestSavedSelectEl = qs("subTestSavedSelect");
    const subTestEndpointEl = qs("subTestEndpoint");
    const subTestOutputEl = qs("subTestOutput");
    const subTestAppEl = qs("subTestApp");
    const subTestDeviceEl = qs("subTestDevice");
    const subTestProfileEl = qs("subTestProfile");
    const subTestProfilesEl = qs("subTestProfiles");
    const subTestProfilesChecksEl = qs("subTestProfilesChecks");
    const subTestHwidEl = qs("subTestHwid");
    const subTestHeadersEl = qs("subTestHeaders");
    const subTestStatusEl = qs("subTestStatus");
    const subTestResponseInfoEl = qs("subTestResponseInfo");
    const subTestSourceFormatEl = qs("subTestSourceFormat");
    const subTestConvertedFormatEl = qs("subTestConvertedFormat");
    const subTestSourceServersEl = qs("subTestSourceServers");
    const subTestConvertedServersEl = qs("subTestConvertedServers");
    const subTestCopySourceBodyEl = qs("subTestCopySourceBody");
    const subTestCopyConvertedBodyEl = qs("subTestCopyConvertedBody");
    const subTestRequestResultEl = qs("subTestRequestResult");
    const subTestHeadersResultEl = qs("subTestHeadersResult");
    const subTestCacheResultEl = qs("subTestCacheResult");

    const STORAGE_KEY = "submirror.favorites.v2";
    const STORAGE_KEY_LEGACY = "submirror.favorites.v1";
    const selectedBaseProfiles = [];

    let currentShortId = "";
    let currentMockId = "";
    let sourceMode = "real";
    let activeShareCard = null;
    let shareFullUrl = "";
    let shareShortUrl = "";
    let editingCardIndex = -1;
    const subTestSelectedProfiles = [];
    let subTestLastSourceBody = "";
    let subTestLastConvertedBody = "";

    function refreshSavedSubTestList() {
      if (!subTestSavedSelectEl) return;
      const list = readFavorites();
      if (!list.length) {
        subTestSavedSelectEl.innerHTML = '<option value="">Сохраненных подписок нет</option>';
        return;
      }
      subTestSavedSelectEl.innerHTML = list
        .map((item, idx) => '<option value="' + idx + '">' + escapeHtml(item.title || ("Подписка " + (idx + 1))) + "</option>")
        .join("");
    }

    function withStatus(message, mode) {
      statusEl.className = mode ? "status " + mode : "status";
      statusEl.textContent = message || "";
    }

    function openComposer() {
      composer.classList.add("open");
      composer.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function closeComposer() {
      composer.classList.remove("open");
    }

    function releaseBodyScrollIfAllClosed() {
      if (
        !shareScreen.classList.contains("open") &&
        !mockScreen.classList.contains("open") &&
        !profileEditorScreen.classList.contains("open") &&
        !subTestScreen.classList.contains("open")
      ) {
        document.body.style.overflow = "";
      }
    }

    function openMockScreen() {
      mockScreen.classList.add("open");
      mockScreen.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }

    function closeMockScreen() {
      mockScreen.classList.remove("open");
      mockScreen.setAttribute("aria-hidden", "true");
      releaseBodyScrollIfAllClosed();
    }

    function withProfileEditorStatus(message, mode) {
      profileEditorStatusEl.className = mode ? "status " + mode : "status";
      profileEditorStatusEl.textContent = message || "";
    }

    function openProfileEditorScreen() {
      profileEditorScreen.classList.add("open");
      profileEditorScreen.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      void refreshProfileCatalog();
    }

    function closeProfileEditorScreen() {
      profileEditorScreen.classList.remove("open");
      profileEditorScreen.setAttribute("aria-hidden", "true");
      releaseBodyScrollIfAllClosed();
    }

    function withSubTestStatus(message, mode) {
      subTestStatusEl.className = mode ? "status " + mode : "status";
      subTestStatusEl.textContent = message || "";
    }

    function openSubTestScreen() {
      subTestScreen.classList.add("open");
      subTestScreen.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      refreshSavedSubTestList();
      void refreshSubTestProfileChoices().catch((e) => withSubTestStatus(e?.message || "Не удалось загрузить профили", "error"));
    }

    function closeSubTestScreen() {
      subTestScreen.classList.remove("open");
      subTestScreen.setAttribute("aria-hidden", "true");
      releaseBodyScrollIfAllClosed();
    }

    async function refreshProfileCatalog() {
      const resp = await fetch("/api/profile-editor/list");
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        throw new Error(json.error || "failed to load profile catalog");
      }
      const kind = profileEditorKindEl.value || "base";
      const list = Array.isArray(json.catalog?.[kind]) ? json.catalog[kind] : [];
      profileEditorListEl.innerHTML = list.length
        ? list.map((name) => '<option value="' + escapeAttr(name) + '">' + escapeHtml(name) + '</option>').join("")
        : '<option value="">(пусто)</option>';
      if (list.length && !list.includes(profileEditorNameEl.value)) {
        profileEditorNameEl.value = list[0];
      }
      return json.catalog;
    }

    function syncSubTestProfilesHidden() {
      subTestProfilesEl.value = subTestSelectedProfiles.slice(1).join(",");
      if (!subTestSelectedProfiles.length) {
        subTestProfileEl.value = "";
      } else if (subTestProfileEl.value !== subTestSelectedProfiles[0]) {
        subTestProfileEl.value = subTestSelectedProfiles[0];
      }
    }

    function setSubTestProfiles(list) {
      subTestSelectedProfiles.length = 0;
      for (const raw of list) {
        const name = String(raw || "").trim();
        if (!name || subTestSelectedProfiles.includes(name)) continue;
        subTestSelectedProfiles.push(name);
      }
      syncSubTestProfilesHidden();
      for (const chip of subTestProfilesChecksEl.querySelectorAll("button[data-profile]")) {
        chip.classList.toggle("active", subTestSelectedProfiles.includes(chip.dataset.profile || ""));
      }
    }

    async function refreshSubTestProfileChoices() {
      const catalog = await refreshProfileCatalog();
      const baseList = Array.isArray(catalog?.base) ? catalog.base : [];
      subTestProfileEl.innerHTML = '<option value="">(не выбрано)</option>' + baseList
        .map((name) => '<option value="' + escapeAttr(name) + '">' + escapeHtml(name) + "</option>")
        .join("");
      subTestProfilesChecksEl.innerHTML = baseList.length
        ? baseList
            .map(
              (name) =>
                '<button type="button" class="chip chip-check" data-profile="' +
                escapeAttr(name) +
                '">' +
                escapeHtml(name) +
                "</button>",
            )
            .join("")
        : '<span style="color:var(--muted);font-size:12px;">Нет профилей</span>';
      setSubTestProfiles([subTestProfileEl.value].filter(Boolean).concat((subTestProfilesEl.value || "").split(",").map((x) => x.trim()).filter(Boolean)));
    }

    async function loadProfileFromEditor() {
      const kind = profileEditorKindEl.value || "base";
      const name = (profileEditorNameEl.value || profileEditorListEl.value || "").trim();
      if (!name) {
        withProfileEditorStatus("Укажите имя профиля", "warn");
        return;
      }
      const url = "/api/profile-editor/file?kind=" + encodeURIComponent(kind) + "&name=" + encodeURIComponent(name);
      const resp = await fetch(url);
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        throw new Error(json.error || "failed to load profile");
      }
      profileEditorNameEl.value = json.name || name;
      profileEditorContentEl.value = json.content || "";
      withProfileEditorStatus("Профиль загружен", "ok");
    }

    async function saveProfileFromEditor() {
      const kind = profileEditorKindEl.value || "base";
      const name = (profileEditorNameEl.value || "").trim();
      const content = profileEditorContentEl.value || "";
      if (!name) {
        withProfileEditorStatus("Укажите имя профиля", "warn");
        return;
      }
      const resp = await fetch("/api/profile-editor/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, content }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        throw new Error(json.error || "failed to save profile");
      }
      await refreshProfileCatalog();
      withProfileEditorStatus("Профиль сохранен", "ok");
    }

    async function deleteProfileFromEditor() {
      const kind = profileEditorKindEl.value || "base";
      const name = (profileEditorNameEl.value || "").trim();
      if (!name) {
        withProfileEditorStatus("Укажите имя профиля", "warn");
        return;
      }
      const url = "/api/profile-editor/file?kind=" + encodeURIComponent(kind) + "&name=" + encodeURIComponent(name);
      const resp = await fetch(url, { method: "DELETE" });
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        throw new Error(json.error || "failed to delete profile");
      }
      profileEditorContentEl.value = "";
      await refreshProfileCatalog();
      withProfileEditorStatus("Профиль удален", "ok");
    }

    function parseSubTestHeadersJson() {
      const raw = (subTestHeadersEl.value || "").trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Заголовки должны быть JSON-объектом");
      }
      return parsed;
    }

    function collectSubTestPayload() {
      syncSubTestProfilesHidden();
      const payload = {
        endpoint: (subTestEndpointEl.value || "last").trim() || "last",
        output: (subTestOutputEl.value || "yml").trim() || "yml",
        sub_url: (subTestSubUrlEl.value || "").trim(),
        app: (subTestAppEl.value || "").trim(),
        device: (subTestDeviceEl.value || "").trim(),
        profile: (subTestProfileEl.value || "").trim(),
        profiles: (subTestProfilesEl.value || "").trim(),
        hwid: (subTestHwidEl.value || "").trim(),
      };
      const cleaned = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v) cleaned[k] = v;
      }
      return { params: cleaned, headers: parseSubTestHeadersJson() };
    }

    function fillSubTestFromComposer() {
      syncBaseProfileHidden();
      subTestSubUrlEl.value = getResolvedSubUrl();
      subTestEndpointEl.value = (state.endpoint.value || "last").trim() || "last";
      subTestOutputEl.value = (state.output.value || "yml").trim() || "yml";
      subTestAppEl.value = (state.app.value || "").trim();
      subTestDeviceEl.value = (state.device.value || "").trim();
      const profileList = [];
      if (state.profile.value) profileList.push((state.profile.value || "").trim());
      for (const raw of (state.profiles.value || "").split(",")) {
        const name = String(raw || "").trim();
        if (!name || profileList.includes(name)) continue;
        profileList.push(name);
      }
      setSubTestProfiles(profileList);
      subTestHwidEl.value = (state.hwid.value || "").trim();
      withSubTestStatus("Параметры перенесены из конструктора", "ok");
    }

    function fillSubTestFromPayload(payload) {
      const data = payload && typeof payload === "object" ? payload : {};
      subTestSubUrlEl.value = String(data.sub_url || "").trim();
      subTestEndpointEl.value = String(data.endpoint || "last").trim() === "sub" ? "sub" : "last";
      subTestOutputEl.value = String(data.output || "yml").trim() || "yml";
      subTestAppEl.value = String(data.app || "").trim();
      subTestDeviceEl.value = String(data.device || "").trim();
      subTestHwidEl.value = String(data.hwid || "").trim();
      const profileList = [];
      if (data.profile) profileList.push(String(data.profile).trim());
      for (const raw of String(data.profiles || "").split(",")) {
        const name = raw.trim();
        if (!name || profileList.includes(name)) continue;
        profileList.push(name);
      }
      setSubTestProfiles(profileList);
    }

    async function applySavedSubscriptionToTester(options = {}) {
      const runAfter = options.runAfter === true;
      if (!subTestSavedSelectEl) return;
      const idx = Number(subTestSavedSelectEl.value || "-1");
      const list = readFavorites();
      if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
        withSubTestStatus("Выберите сохраненную подписку", "warn");
        return;
      }
      const item = list[idx];
      let payload = item.payload && typeof item.payload === "object" ? item.payload : null;
      if (!payload || !payload.sub_url) {
        const parsed = parseUrlToValues(item.url || "");
        if (parsed.ok && parsed.values) {
          payload = parsed.values;
        } else if (parsed.ok && parsed.isShort && parsed.shortId) {
          const link = await fetchShortLink(parsed.shortId);
          payload = link.params || {};
        }
      }
      fillSubTestFromPayload(payload || {});
      withSubTestStatus("Сохраненная подписка загружена в тестер", "ok");
      if (runAfter) {
        await runSubTest();
      }
    }

    function pretty(obj) {
      return JSON.stringify(obj, null, 2);
    }

    function renderServerSelect(selectEl, servers, emptyText) {
      const list = Array.isArray(servers) ? servers : [];
      if (!list.length) {
        selectEl.innerHTML = '<option value="">' + escapeHtml(emptyText) + "</option>";
        return;
      }
      selectEl.innerHTML = list
        .map((name, idx) => '<option value="' + escapeAttr(name) + '">' + String(idx + 1) + ". " + escapeHtml(name) + "</option>")
        .join("");
    }

    function renderSubTestResult(data) {
      const conversion = data?.conversion || {};
      const upstream = data?.upstream || {};
      const sourceServers = Array.isArray(upstream.servers) ? upstream.servers : [];
      const convertedServers = Array.isArray(conversion.servers) ? conversion.servers : [];
      subTestLastSourceBody = String(upstream.body || "");
      subTestLastConvertedBody = String(conversion.body || "");

      const responseInfo = [
        "HTTP: " + String(upstream.status ?? "-"),
        "URL: " + String(upstream.url || "-"),
        "Размер: " + String(upstream.bodyBytes || 0) + " bytes",
        "Конвертация: " + (conversion.ok ? "успешно" : "ошибка"),
      ];
      if (!conversion.ok && conversion.error) {
        responseInfo.push("Ошибка: " + conversion.error);
      } else if (conversion.ok && conversion.conversion) {
        responseInfo.push("Тип: " + conversion.conversion);
      }
      subTestResponseInfoEl.textContent = responseInfo.join("\\n");
      subTestSourceFormatEl.textContent = String(upstream.sourceFormat || "-");
      subTestConvertedFormatEl.textContent = conversion.ok
        ? String(conversion.outputFormat || "-")
        : "-";
      renderServerSelect(subTestSourceServersEl, sourceServers, "Серверы не найдены");
      renderServerSelect(subTestConvertedServersEl, convertedServers, conversion.ok ? "Серверы не найдены" : "Конвертация не выполнена");

      const reqBlock = {
        endpoint: data?.request?.endpoint || "",
        subUrl: data?.request?.subUrl || "",
        output: data?.request?.output || "",
        app: data?.request?.app || "",
        device: data?.request?.device || "",
        profiles: data?.request?.profiles || [],
        upstreamStatus: data?.upstream?.status,
        upstreamUrl: data?.upstream?.url || "",
        sourceFormat: data?.upstream?.sourceFormat || "",
        bodyBytes: data?.upstream?.bodyBytes || 0,
        sourceServersCount: sourceServers.length,
        convertedServersCount: convertedServers.length,
      };
      subTestRequestResultEl.textContent = pretty(reqBlock);
      subTestHeadersResultEl.textContent = pretty(data?.headers || {});

      const cache = data?.cache || {};
      const cacheBlock = {
        exists: cache.exists === true,
        key: cache.key || "",
        path: cache.path || "",
        bytes: cache.bytes || 0,
        bodySha1: cache.bodySha1 || "",
        meta: cache.meta || null,
        validation: cache.validation || {},
      };
      subTestCacheResultEl.textContent = pretty(cacheBlock);
    }

    async function runSubTest() {
      const payload = collectSubTestPayload();
      if (!payload.params.sub_url) {
        withSubTestStatus("Укажите sub_url для теста", "warn");
        return;
      }
      withSubTestStatus("Выполняю запрос и анализ...", "");
      const resp = await fetch("/api/sub-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        throw new Error(json.error || "Не удалось выполнить тест");
      }
      renderSubTestResult(json);
      withSubTestStatus("Диагностика обновлена", "ok");
    }

    function getResolvedSubUrl() {
      if (sourceMode === "test") {
        return (mockSourceUrlEl.value || "").trim();
      }
      return (state.sub_url.value || "").trim();
    }

    function syncSourceModeChips() {
      for (const chip of qs("sourceModeChips").querySelectorAll("button[data-value]")) {
        chip.classList.toggle("active", (chip.dataset.value || "") === sourceMode);
      }
      realSourceWrap.classList.toggle("hidden", sourceMode !== "real");
      testSourceWrap.classList.toggle("hidden", sourceMode !== "test");
    }

    function syncBaseProfileHidden() {
      state.profile.value = selectedBaseProfiles[0] || "";
      state.profiles.value = selectedBaseProfiles.slice(1).join(",");
    }

    function syncBaseProfileChips() {
      const group = qs("baseProfileChecks");
      for (const chip of group.querySelectorAll("button[data-profile]")) {
        chip.classList.toggle("active", selectedBaseProfiles.includes(chip.dataset.profile || ""));
      }
    }

    function setBaseProfiles(list) {
      selectedBaseProfiles.length = 0;
      for (const raw of list) {
        const name = String(raw || "").trim();
        if (!name || selectedBaseProfiles.includes(name)) continue;
        selectedBaseProfiles.push(name);
      }
      syncBaseProfileHidden();
      syncBaseProfileChips();
    }

    function activateSingleChip(groupId, inputId) {
      const group = qs(groupId);
      group.addEventListener("click", (event) => {
        const chip = event.target.closest("button[data-value]");
        if (!chip) return;
        state[inputId].value = chip.dataset.value || "";
        syncChips();
        update();
      });
    }

    function syncChips() {
      const pairs = [
        ["outputChips", "output"],
        ["appChips", "app"],
        ["deviceChips", "device"],
      ];
      for (const pair of pairs) {
        const group = qs(pair[0]);
        const val = state[pair[1]].value;
        for (const el of group.querySelectorAll("button[data-value]")) {
          el.classList.toggle("active", (el.dataset.value || "") === val);
        }
      }
      const isCache = (state.endpoint.value || "last") === "last";
      qs("cacheToggle").classList.toggle("active", isCache);
      qs("cacheToggle").textContent = isCache ? "Кэшировать подписку" : "Без кэширования";
      syncSourceModeChips();
    }

    function composePayload() {
      syncBaseProfileHidden();
      const subUrl = getResolvedSubUrl();
      const payload = {
        endpoint: (state.endpoint.value || "last").trim() || "last",
        output: (state.output.value || "yml").trim() || "yml",
      };
      if (subUrl) payload.sub_url = subUrl;
      for (const key of ["app", "device", "profile", "profiles", "hwid"]) {
        const value = (state[key].value || "").trim();
        if (value) payload[key] = value;
      }
      return payload;
    }

    function buildUrl() {
      const payload = composePayload();
      const endpoint = payload.endpoint === "sub" ? "sub" : "last";
      const params = new URLSearchParams();
      for (const key of ["sub_url", "output", "app", "device", "profile", "profiles", "hwid"]) {
        if (payload[key]) params.set(key, payload[key]);
      }
      if (!params.get("output")) params.set("output", "yml");
      return window.location.origin + "/" + endpoint + "?" + params.toString();
    }

    function updateVisibility() {
      const hasSource = Boolean(getResolvedSubUrl());
      paramsSection.classList.toggle("hidden", !hasSource);
      saveActionsSection.classList.toggle("hidden", !hasSource);
    }

    function update() {
      updateVisibility();
      if (!getResolvedSubUrl()) withStatus("Сначала выберите источник подписки", "warn");
      else withStatus("", "");
      return buildUrl();
    }

    function parseUrlToValues(raw) {
      try {
        const u = new URL(raw, window.location.origin);
        let path = u.pathname || "";
        while (path.startsWith("/")) path = path.slice(1);
        if (path.startsWith("l/")) {
          const shortId = path.slice(2).trim();
          if (/^[A-Za-z0-9_-]+$/.test(shortId)) {
            return { ok: true, isShort: true, shortId };
          }
        }
        if (path.startsWith("mock/")) {
          const mockId = path.slice(5).trim();
          if (/^[A-Za-z0-9_-]+$/.test(mockId)) {
            return { ok: true, isMock: true, mockId };
          }
        }

        return {
          ok: true,
          values: {
            endpoint: path === "sub" ? "sub" : "last",
            sub_url: u.searchParams.get("sub_url") || "",
            output: u.searchParams.get("output") || "yml",
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

    function setValues(values) {
      for (const key of fields) {
        state[key].value = values[key] || "";
      }
      const mergedProfiles = [];
      if (state.profile.value) mergedProfiles.push(state.profile.value);
      for (const p of (state.profiles.value || "").split(",").map((x) => x.trim()).filter(Boolean)) {
        if (!mergedProfiles.includes(p)) mergedProfiles.push(p);
      }
      setBaseProfiles(mergedProfiles);
      syncChips();
    }

    async function writeClipboard(text) {
      const value = String(text || "");
      if (!value) return false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch {
        // fallback below
      }
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        ta.style.left = "-9999px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }

    async function copyText(text) {
      const ok = await writeClipboard(text);
      withStatus(ok ? "Скопировано" : "Не удалось скопировать", ok ? "ok" : "error");
    }

    function labelsFromPayload(payload) {
      const labels = [];
      labels.push((payload.output || "yml").toLowerCase());
      if (payload.app) labels.push(payload.app);
      if (payload.device) labels.push(payload.device);
      if (payload.profile) labels.push("profile:" + payload.profile);
      if (payload.profiles) labels.push("profiles:" + payload.profiles);
      return labels;
    }

    function readFavorites() {
      const normalize = (list) => list.map((item) => {
        if (item && typeof item === "object" && Array.isArray(item.labels) && item.title) {
          return item;
        }
        return {
          url: String(item?.url || ""),
          title: String(item?.name || "Подписка"),
          labels: [],
          payload: {},
          ts: item?.ts || Date.now(),
        };
      }).filter((item) => item.url);

      try {
        const rawNew = localStorage.getItem(STORAGE_KEY);
        if (rawNew) {
          const parsed = JSON.parse(rawNew);
          if (Array.isArray(parsed)) return normalize(parsed);
        }
      } catch {}

      try {
        const rawLegacy = localStorage.getItem(STORAGE_KEY_LEGACY);
        if (rawLegacy) {
          const parsed = JSON.parse(rawLegacy);
          if (Array.isArray(parsed)) return normalize(parsed);
        }
      } catch {}
      return [];
    }

    function writeFavorites(list) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 40)));
    }

    function renderFavorites() {
      const list = readFavorites();
      if (!list.length) {
        savedCardsEl.innerHTML = '<article class=\"sub-card\"><div class=\"sub-name\">Еще не добавлена ни одна подписка.</div></article>';
        refreshSavedSubTestList();
        return;
      }
      savedCardsEl.innerHTML = list.map((item, idx) => {
        const title = escapeHtml(item.title || "Подписка");
        const url = escapeHtml(item.url || "");
        const labels = Array.isArray(item.labels) ? item.labels : [];
        const labelsHtml = labels.map((l) => '<span class="label">' + escapeHtml(l) + '</span>').join("");
        return ''
          + '<article class="sub-card" data-card-idx="' + idx + '">'
          + '  <div class="sub-head">'
          + '    <div class="sub-name">' + title + '</div>'
          + '    <div class="toolbar">'
          + '      <button class="btn icon-btn" title="Открыть" aria-label="Открыть" data-action="open" data-idx="' + idx + '">'
          + '        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M5 8v11h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          + '      </button>'
          + '      <button class="btn icon-btn" title="Редактировать" aria-label="Редактировать" data-action="edit" data-idx="' + idx + '">'
          + '        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4zM13 7l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          + '      </button>'
          + '      <button class="btn btn-danger icon-btn" title="Удалить" aria-label="Удалить" data-action="delete" data-idx="' + idx + '">'
          + '        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          + '      </button>'
          + '    </div>'
          + '  </div>'
          + '  <div class="sub-url">' + url + '</div>'
          + '  <div class="labels">' + labelsHtml + '</div>'
          + '</article>';
      }).join("");
      refreshSavedSubTestList();
    }

    function escapeHtml(value) {
      return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function hasNameConflict(name, ignoreIndex = -1) {
      const normalized = String(name || "").trim().toLowerCase();
      if (!normalized) return false;
      const list = readFavorites();
      return list.some((item, idx) => idx !== ignoreIndex && String(item.title || "").trim().toLowerCase() === normalized);
    }

    async function ensureShortLink(payload, options = {}) {
      const forceNew = options.forceNew === true;
      const existing = options.existingItem || null;
      if (!forceNew && existing && existing.shortId && existing.url) {
        const updateRes = await fetch("/api/short-links/" + encodeURIComponent(existing.shortId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const updateJson = await updateRes.json();
        if (!updateRes.ok || !updateJson.ok) {
          throw new Error(updateJson.error || "Не удалось обновить короткую ссылку");
        }
        return { shortId: existing.shortId, shortUrl: existing.url };
      }
      const shortRes = await fetch("/api/short-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const shortJson = await shortRes.json();
      if (!shortRes.ok || !shortJson.ok) {
        throw new Error(shortJson.error || "Не удалось создать короткую ссылку");
      }
      const shortId = shortJson.link.id;
      return { shortId, shortUrl: window.location.origin + "/l/" + shortId };
    }

    async function saveSubscription(options = {}) {
      const payload = composePayload();
      if (!payload.sub_url) {
        withStatus("Сначала укажите источник подписки", "warn");
        return;
      }
      const name = (subNameEl.value || "").trim();
      if (!name) {
        withStatus("Укажите название подписки", "warn");
        return;
      }
      const list = readFavorites();
      const forceNew = options.forceNew === true;
      const saveIndex = forceNew ? -1 : editingCardIndex;
      if (hasNameConflict(name, saveIndex)) {
        withStatus("Подписка с таким именем уже существует", "error");
        return;
      }

      const existingItem = saveIndex >= 0 ? list[saveIndex] : null;
      const { shortId, shortUrl } = await ensureShortLink(payload, { forceNew, existingItem });
      const labels = labelsFromPayload(payload);

      const nextItem = { url: shortUrl, title: name, labels, payload, ts: Date.now(), shortId };
      let nextList = list.slice();
      if (saveIndex >= 0 && !forceNew) {
        nextList[saveIndex] = nextItem;
      } else {
        nextList = nextList.filter((item) => item.url !== shortUrl && String(item.title || "").trim().toLowerCase() !== name.toLowerCase());
        nextList.unshift(nextItem);
      }

      editingCardIndex = -1;
      currentShortId = shortId;
      sourceMode = "real";
      setValues({
        endpoint: payload.endpoint,
        sub_url: payload.sub_url,
        output: payload.output,
        app: payload.app || "",
        device: payload.device || "",
        profile: payload.profile || "",
        profiles: payload.profiles || "",
        hwid: payload.hwid || "",
      });
      syncChips();
      update();

      writeFavorites(nextList);
      renderFavorites();
      closeComposer();
      withStatus((forceNew ? "Сохранено как: " : "Сохранено: ") + shortUrl, "ok");
    }

    async function addFavorite() {
      await saveSubscription({ forceNew: false });
    }

    async function saveAsFavorite() {
      await saveSubscription({ forceNew: true });
    }

    function buildFullUrlFromPayload(payload) {
      const data = payload && typeof payload === "object" ? payload : {};
      const endpoint = data.endpoint === "sub" ? "sub" : "last";
      const params = new URLSearchParams();
      for (const key of ["sub_url", "output", "app", "device", "profile", "profiles", "hwid"]) {
        const value = String(data[key] || "").trim();
        if (value) params.set(key, value);
      }
      if (!params.get("output")) params.set("output", "yml");
      return window.location.origin + "/" + endpoint + "?" + params.toString();
    }

    function renderShareQr(url) {
      if (!url) {
        shareQrWrap.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;">Нет ссылки для QR</div>';
        return;
      }
      const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=" + encodeURIComponent(url);
      shareQrWrap.innerHTML = '<img alt="QR" src="' + qrUrl + '">';
    }

    function openShareScreen(card) {
      activeShareCard = card;
      const fullUrl = buildFullUrlFromPayload(card.payload || {});
      const shortUrl = String(card.url || "");
      shareFullUrl = fullUrl;
      shareShortUrl = shortUrl || fullUrl;
      shareCardTitle.textContent = card.title || "Поделиться подпиской";
      renderShareQr(shortUrl || fullUrl);
      shareScreen.classList.add("open");
      shareScreen.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }

    function closeShareScreen() {
      shareScreen.classList.remove("open");
      shareScreen.setAttribute("aria-hidden", "true");
      releaseBodyScrollIfAllClosed();
      activeShareCard = null;
      shareFullUrl = "";
      shareShortUrl = "";
    }

    async function fetchShortLink(id) {
      const resp = await fetch("/api/short-links/" + encodeURIComponent(id));
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "failed to load short link");
      return json.link;
    }

    async function loadShortLink(id) {
      const link = await fetchShortLink(id);
      const p = link.params || {};
      setValues({
        endpoint: p.endpoint === "sub" ? "sub" : "last",
        sub_url: p.sub_url || "",
        output: p.output || "yml",
        app: p.app || "",
        device: p.device || "",
        profile: p.profile || "",
        profiles: p.profiles || "",
        hwid: p.hwid || "",
      });
      sourceMode = "real";
      currentShortId = link.id;
      openComposer();
      update();
      withStatus("Short ссылка загружена", "ok");
    }

    function extractMockId(raw) {
      const value = String(raw || "").trim();
      if (!value) return "";
      const direct = value.match(/^([A-Za-z0-9_-]+)$/);
      if (direct) return direct[1];
      try {
        const u = new URL(value, window.location.origin);
        let path = u.pathname || "";
        while (path.startsWith("/")) path = path.slice(1);
        if (!path.startsWith("mock/")) return "";
        const id = path.slice(5).trim();
        return /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
      } catch {
        return "";
      }
    }

    function parseHeadersJson() {
      const raw = (mockHeadersEl.value || "").trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("headers must be JSON object");
      }
      return parsed;
    }

    function collectMockPayload() {
      return {
        preset: (mockPresetEl.value || "stub_raw").trim(),
        status: Number((mockStatusEl.value || "200").trim()),
        contentType: (mockContentTypeEl.value || "").trim(),
        delayMs: Number((mockDelayMsEl.value || "0").trim()),
        body: mockBodyEl.value || "",
        headers: parseHeadersJson(),
      };
    }

    function fillMockForm(source) {
      const cfg = source?.config || {};
      mockPresetEl.value = cfg.preset || "stub_raw";
      mockStatusEl.value = String(cfg.status ?? 200);
      mockContentTypeEl.value = String(cfg.contentType || "text/plain; charset=utf-8");
      mockDelayMsEl.value = String(cfg.delayMs ?? 0);
      mockBodyEl.value = String(cfg.body || "");
      mockHeadersEl.value = JSON.stringify(cfg.headers || {}, null, 2);
    }

    function renderMockSource(id) {
      if (!id) return;
      currentMockId = id;
      mockSourceUrlEl.value = window.location.origin + "/mock/" + id;
      if (mockSourcePreviewEl) {
        mockSourcePreviewEl.textContent = mockSourceUrlEl.value;
      }
    }

    function renderMockLogs(logs) {
      if (!Array.isArray(logs) || logs.length === 0) {
        mockLogsEl.textContent = "Логов пока нет";
        return;
      }
      const lines = logs.map((entry, index) => {
        const head = "#" + (index + 1) + " " + (entry.ts || "") + " " + (entry.method || "") + " " + (entry.path || "");
        const query = "query: " + JSON.stringify(entry.query || {});
        const headers = "headers: " + JSON.stringify(entry.headers || {}, null, 2);
        const body = "body (" + (entry.bodyBytes || 0) + "b): " + (entry.body || "");
        return [head, query, headers, body].join("\\n");
      });
      mockLogsEl.textContent = lines.join("\\n\\n------------------------------\\n\\n");
    }

    async function refreshMockLogs() {
      if (!currentMockId) return;
      const resp = await fetch("/api/mock-sources/" + encodeURIComponent(currentMockId) + "/logs");
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "failed to load mock logs");
      renderMockLogs(json.logs || []);
    }

    async function createMockSource() {
      const payload = collectMockPayload();
      const resp = await fetch("/api/mock-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "failed to create mock source");
      renderMockSource(json.source.id);
      fillMockForm(json.source);
      renderMockLogs([]);
      withStatus("Mock сервер создан", "ok");
    }

    async function loadMockSource(idOrUrl) {
      const id = extractMockId(idOrUrl || mockSourceUrlEl.value);
      if (!id) throw new Error("Укажите корректный mock URL или id");
      const resp = await fetch("/api/mock-sources/" + encodeURIComponent(id));
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "failed to load mock source");
      renderMockSource(json.source.id);
      fillMockForm(json.source);
      await refreshMockLogs();
      withStatus("Mock сервер загружен", "ok");
    }

    async function updateMockSource() {
      if (!currentMockId) throw new Error("Сначала создайте или загрузите mock сервер");
      const payload = collectMockPayload();
      const resp = await fetch("/api/mock-sources/" + encodeURIComponent(currentMockId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "failed to update mock source");
      fillMockForm(json.source);
      withStatus("Mock сервер обновлен", "ok");
    }

    async function clearMockLogs() {
      if (!currentMockId) throw new Error("Сначала создайте или загрузите mock сервер");
      const resp = await fetch("/api/mock-sources/" + encodeURIComponent(currentMockId) + "/logs", { method: "POST" });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || "failed to clear logs");
      renderMockLogs([]);
      withStatus("Логи mock сервера очищены", "ok");
    }

    function openImportModal() {
      importModal.classList.add("open");
      setTimeout(() => importInput.focus(), 20);
    }

    function closeImportModal() {
      importModal.classList.remove("open");
    }

    function applyImport() {
      const parsed = parseUrlToValues((importInput.value || "").trim());
      if (!parsed.ok) {
        withStatus(parsed.error, "error");
        return;
      }
      if (parsed.isShort && parsed.shortId) {
        loadShortLink(parsed.shortId).then(closeImportModal).catch((e) => withStatus(e?.message || "Не удалось загрузить short", "error"));
        return;
      }
      if (parsed.isMock && parsed.mockId) {
        sourceMode = "test";
        renderMockSource(parsed.mockId);
        syncChips();
        openComposer();
        loadMockSource(parsed.mockId).then(() => {
          update();
          closeImportModal();
        }).catch((e) => withStatus(e?.message || "Не удалось загрузить mock", "error"));
        return;
      }
      setValues(parsed.values);
      sourceMode = "real";
      currentShortId = "";
      openComposer();
      update();
      closeImportModal();
      withStatus("Параметры импортированы", "ok");
    }

    function onStartAction(event) {
      const raw = event.target;
      const base = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement ? raw.parentElement : null;
      if (!base || typeof base.closest !== "function") return;
      const target = base.closest("button");
      if (!target) return;
      if (target.id === "openComposerAdd") {
        editingCardIndex = -1;
        subNameEl.value = "";
        openComposer();
        update();
      } else if (target.id === "openImportModal") {
        openImportModal();
      }
    }

    function on(id, eventName, handler) {
      const el = qs(id);
      if (!el) return;
      el.addEventListener(eventName, handler);
    }

    on("quickLaunch", "click", onStartAction);
    on("quickLaunch", "pointerup", onStartAction);
    on("openComposerAdd", "click", () => {
      editingCardIndex = -1;
      subNameEl.value = "";
      openComposer();
      update();
    });
    on("openImportModal", "click", openImportModal);
    on("openMockStudioChip", "click", openMockScreen);
    on("openMockStudioFromComposer", "click", openMockScreen);
    on("closeMockScreen", "click", closeMockScreen);
    on("openProfileEditorChip", "click", openProfileEditorScreen);
    on("closeProfileEditorScreen", "click", closeProfileEditorScreen);
    on("openSubTestChip", "click", () => {
      openSubTestScreen();
      fillSubTestFromComposer();
    });
    on("closeSubTestScreen", "click", closeSubTestScreen);
    on("subTestFillFromComposer", "click", fillSubTestFromComposer);
    on("subTestRun", "click", async () => {
      try { await runSubTest(); } catch (e) { withSubTestStatus(e?.message || "Не удалось выполнить тест", "error"); }
    });
    if (subTestCopySourceBodyEl) {
      subTestCopySourceBodyEl.addEventListener("click", async () => {
        if (!subTestLastSourceBody) {
          withSubTestStatus("Нет исходного ответа для копирования", "warn");
          return;
        }
        const ok = await writeClipboard(subTestLastSourceBody);
        withSubTestStatus(ok ? "Исходный ответ скопирован" : "Не удалось скопировать исходный ответ", ok ? "ok" : "error");
      });
    }
    if (subTestCopyConvertedBodyEl) {
      subTestCopyConvertedBodyEl.addEventListener("click", async () => {
        if (!subTestLastConvertedBody) {
          withSubTestStatus("Нет результата конвертации для копирования", "warn");
          return;
        }
        const ok = await writeClipboard(subTestLastConvertedBody);
        withSubTestStatus(ok ? "Результат конвертации скопирован" : "Не удалось скопировать результат конвертации", ok ? "ok" : "error");
      });
    }
    on("subTestSavedRefresh", "click", refreshSavedSubTestList);
    on("subTestSavedApply", "click", async () => {
      try { await applySavedSubscriptionToTester({ runAfter: false }); } catch (e) { withSubTestStatus(e?.message || "Не удалось загрузить сохраненную", "error"); }
    });
    on("subTestSavedRun", "click", async () => {
      try { await applySavedSubscriptionToTester({ runAfter: true }); } catch (e) { withSubTestStatus(e?.message || "Не удалось проверить сохраненную", "error"); }
    });
    if (subTestProfileEl) {
      subTestProfileEl.addEventListener("change", () => {
        const value = (subTestProfileEl.value || "").trim();
        const rest = subTestSelectedProfiles.filter((name) => name !== value);
        setSubTestProfiles(value ? [value].concat(rest) : rest);
      });
    }
    if (subTestProfilesChecksEl) {
      subTestProfilesChecksEl.addEventListener("click", (event) => {
        const chip = event.target.closest("button[data-profile]");
        if (!chip) return;
        const name = chip.dataset.profile || "";
        if (!name) return;
        const idx = subTestSelectedProfiles.indexOf(name);
        if (idx >= 0) {
          subTestSelectedProfiles.splice(idx, 1);
        } else {
          subTestSelectedProfiles.push(name);
        }
        syncSubTestProfilesHidden();
        for (const item of subTestProfilesChecksEl.querySelectorAll("button[data-profile]")) {
          item.classList.toggle("active", subTestSelectedProfiles.includes(item.dataset.profile || ""));
        }
      });
    }
    profileEditorKindEl.addEventListener("change", () => {
      void refreshProfileCatalog().catch((e) => withProfileEditorStatus(e?.message || "Не удалось загрузить список", "error"));
    });
    profileEditorListEl.addEventListener("change", () => {
      if (profileEditorListEl.value) {
        profileEditorNameEl.value = profileEditorListEl.value;
      }
    });
    on("profileEditorNew", "click", () => {
      profileEditorNameEl.value = "";
      profileEditorContentEl.value = "";
      withProfileEditorStatus("", "");
    });
    on("profileEditorLoad", "click", async () => {
      try { await loadProfileFromEditor(); } catch (e) { withProfileEditorStatus(e?.message || "Не удалось загрузить профиль", "error"); }
    });
    on("profileEditorSave", "click", async () => {
      try { await saveProfileFromEditor(); } catch (e) { withProfileEditorStatus(e?.message || "Не удалось сохранить профиль", "error"); }
    });
    on("profileEditorDelete", "click", async () => {
      try { await deleteProfileFromEditor(); } catch (e) { withProfileEditorStatus(e?.message || "Не удалось удалить профиль", "error"); }
    });

    on("closeComposer", "click", closeComposer);
    on("importClose", "click", closeImportModal);
    on("importApply", "click", applyImport);
    importModal.addEventListener("click", (event) => {
      if (event.target === importModal) closeImportModal();
    });

    on("sourceModeChips", "click", (event) => {
      const chip = event.target.closest("button[data-value]");
      if (!chip) return;
      sourceMode = chip.dataset.value === "test" ? "test" : "real";
      syncChips();
      update();
    });

    activateSingleChip("outputChips", "output");
    activateSingleChip("appChips", "app");
    activateSingleChip("deviceChips", "device");

    on("baseProfileChecks", "click", (event) => {
      const chip = event.target.closest("button[data-profile]");
      if (!chip) return;
      const name = chip.dataset.profile || "";
      if (!name) return;
      const idx = selectedBaseProfiles.indexOf(name);
      if (idx >= 0) selectedBaseProfiles.splice(idx, 1);
      else selectedBaseProfiles.push(name);
      syncBaseProfileHidden();
      syncBaseProfileChips();
      update();
    });

    on("cacheToggle", "click", () => {
      const nextIsCache = state.endpoint.value !== "last";
      state.endpoint.value = nextIsCache ? "last" : "sub";
      syncChips();
      update();
    });

    state.sub_url.addEventListener("input", update);
    state.hwid.addEventListener("input", update);
    subNameEl.addEventListener("input", update);
    mockSourceUrlEl.addEventListener("input", update);
    on("saveSubscription", "click", async () => {
      try { await addFavorite(); } catch (e) { withStatus(e?.message || "Не удалось сохранить подписку", "error"); }
    });
    on("saveAsSubscription", "click", async () => {
      try { await saveAsFavorite(); } catch (e) { withStatus(e?.message || "Не удалось сохранить подписку", "error"); }
    });

    on("mockCreate", "click", async () => {
      try {
        await createMockSource();
        sourceMode = "test";
        syncChips();
        update();
      } catch (e) {
        withStatus(e?.message || "Не удалось создать mock", "error");
      }
    });
    on("mockLoad", "click", async () => {
      try {
        await loadMockSource();
        sourceMode = "test";
        syncChips();
        update();
      } catch (e) {
        withStatus(e?.message || "Не удалось загрузить mock", "error");
      }
    });
    on("mockUpdate", "click", async () => {
      try { await updateMockSource(); } catch (e) { withStatus(e?.message || "Не удалось обновить mock", "error"); }
    });
    on("mockUseAsSubUrl", "click", () => {
      const id = extractMockId(mockSourceUrlEl.value) || currentMockId;
      if (!id) {
        withStatus("Сначала создайте или загрузите mock сервер", "warn");
        return;
      }
      renderMockSource(id);
      sourceMode = "test";
      syncChips();
      update();
      closeMockScreen();
      withStatus("Тестовый источник выбран", "ok");
    });
    on("mockRefreshLogs", "click", async () => {
      try { await refreshMockLogs(); withStatus("Логи обновлены", "ok"); } catch (e) { withStatus(e?.message || "Не удалось обновить логи", "error"); }
    });
    on("mockClearLogs", "click", async () => {
      try { await clearMockLogs(); } catch (e) { withStatus(e?.message || "Не удалось очистить логи", "error"); }
    });
    on("closeShareScreen", "click", closeShareScreen);
    on("shareCopyFull", "click", () => void copyText(shareFullUrl));
    on("shareCopyShort", "click", () => void copyText(shareShortUrl));
    on("shareOpenHapp", "click", () => {
      const url = shareFullUrl;
      if (!url) return;
      window.location.href = "happ://add-subscription?url=" + encodeURIComponent(url);
    });
    on("shareOpenFl", "click", () => {
      const url = shareFullUrl;
      if (!url) return;
      window.location.href = "flclash://install-config?url=" + encodeURIComponent(url);
    });

    savedCardsEl.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-action]");
      const cardRoot = event.target.closest("[data-card-idx]");
      const idx = target
        ? Number(target.dataset.idx || "-1")
        : cardRoot
          ? Number(cardRoot.dataset.cardIdx || "-1")
          : -1;
      const list = readFavorites();
      if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
      const item = list[idx];
      const action = target ? (target.dataset.action || "") : "share";

      if (action === "share") {
        openShareScreen(item);
        return;
      }

      if (action === "open") {
        window.open(item.url || "", "_blank", "noopener,noreferrer");
        return;
      }
      if (action === "edit") {
        const parsed = parseUrlToValues(item.url || "");
        if (!parsed.ok) {
          withStatus("Ссылка в карточке повреждена", "error");
          return;
        }
        editingCardIndex = idx;
        subNameEl.value = item.title || "";
        openComposer();
        if (parsed.isShort && parsed.shortId) {
          loadShortLink(parsed.shortId).catch((e) => withStatus(e?.message || "Не удалось загрузить short", "error"));
          return;
        }
        if (parsed.isMock && parsed.mockId) {
          sourceMode = "test";
          renderMockSource(parsed.mockId);
          syncChips();
          loadMockSource(parsed.mockId).then(update).catch((e) => withStatus(e?.message || "Не удалось загрузить mock", "error"));
          return;
        }
        sourceMode = "real";
        setValues(parsed.values);
        currentShortId = "";
        syncChips();
        update();
        withStatus("Карточка загружена в форму", "ok");
        return;
      }
      if (action === "delete") {
        list.splice(idx, 1);
        writeFavorites(list);
        renderFavorites();
        withStatus("Карточка удалена", "ok");
      }
    });

    const startUrl = new URL(window.location.href);
    const sid = startUrl.searchParams.get("sid");
    const mid = startUrl.searchParams.get("mid");
    const from = startUrl.searchParams.get("from");

    setBaseProfiles([]);
    syncChips();
    renderFavorites();
    update();

    if (mid) {
      openComposer();
      sourceMode = "test";
      renderMockSource(mid);
      syncChips();
      loadMockSource(mid).then(update).catch(() => withStatus("Не удалось загрузить mock сервер", "error"));
    }
    if (sid) {
      openComposer();
      loadShortLink(sid).catch(() => withStatus("Не удалось загрузить short ссылку", "error"));
    } else if (from) {
      importInput.value = from;
      openImportModal();
    }

    setInterval(() => {
      if (!currentMockId) return;
      refreshMockLogs().catch(() => {});
    }, 4000);
  </script>
</body>
</html>`;
}

export { renderHomePage };
