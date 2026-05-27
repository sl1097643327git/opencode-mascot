const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { STATUSES } = require('./constants');

const MAX_BODY_BYTES = 32 * 1024;

function hasOwn(object, property) {
  return Object.hasOwn(object, property);
}

function pickPersistedCharacterPatch(patch) {
  const persistedPatch = {};

  for (const field of ['name', 'integrationDetail', 'theme', 'visible', 'showStatus', 'width', 'zIndex']) {
    if (hasOwn(patch, field)) {
      persistedPatch[field] = patch[field];
    }
  }

  return persistedPatch;
}

function hasPersistedCharacterPatch(patch) {
  return Object.keys(patch).length > 0;
}

function ignoreBadRequestParseError(error) {
  void error;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(html));
  res.end(html);
}

function defaultListThemes(assetsRoot = path.join(__dirname, '..', 'assets', 'mascot')) {
  try {
    return fs
      .readdirSync(assetsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) {
      return [];
    }
    throw error;
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let bytes = 0;
    let tooLarge = false;

    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }

      bytes += Buffer.byteLength(chunk);

      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }

      raw += chunk;
    });

    req.on('end', () => {
      if (tooLarge) {
        resolve({ ok: false, code: 'BAD_REQUEST' });
        return;
      }

      if (!raw) {
        resolve({ ok: true, body: {} });
        return;
      }

      try {
        resolve({ ok: true, body: JSON.parse(raw) });
      } catch (error) {
        ignoreBadRequestParseError(error);
        resolve({ ok: false, code: 'BAD_REQUEST' });
      }
    });

    req.on('error', () => {
      resolve({ ok: false, code: 'BAD_REQUEST' });
    });
  });
}

function validateStringField(body, fieldName) {
  if (typeof body[fieldName] !== 'string') {
    return {
      ok: false,
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: `Expected string field: ${fieldName}`
    };
  }

  return { ok: true, value: body[fieldName] };
}

function validateBooleanField(body, fieldName) {
  if (typeof body[fieldName] !== 'boolean') {
    return {
      ok: false,
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: `Expected boolean field: ${fieldName}`
    };
  }

  return { ok: true, value: body[fieldName] };
}

function createApiHelp({ integrations = {} } = {}) {
  const endpoints = {
    help: 'GET /',
    status: 'GET /status',
    setGlobalStatus: 'POST /status { "status": "working" }',
    setCharacterStatus: 'POST /characters/:id/status { "status": "busy" }',
    setCharacterVisibility: 'POST /characters/:id/visibility { "visible": true }'
  };

  if (integrations.opencode) {
    Object.assign(endpoints, {
      integrationOpencodeHello: 'POST /opencode/client/hello',
      integrationOpencodeHeartbeat: 'POST /opencode/client/heartbeat',
      integrationOpencodeDisconnect: 'POST /opencode/client/disconnect',
      integrationOpencodeEvent: 'POST /opencode/event',
      integrationOpencodeState: 'GET /opencode/state'
    });
  }

  return {
    ok: true,
    name: 'desktop mascot control API',
    description: 'Local-only HTTP API for controlling desktop mascot status, per-character actions, visibility, and optional external integrations.',
    baseUrl: 'http://127.0.0.1:17890',
    statuses: STATUSES,
    endpoints,
    examples: [
      'POST /status { "status": "working" }',
      'POST /characters/assistant/status { "status": "done" }',
      'POST /characters/reviewer/visibility { "visible": false }'
    ]
  };
}

function createControlPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>看板娘控制台</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1020; --card:rgba(255,255,255,.08); --line:rgba(255,255,255,.14); --text:#f7f3e8; --muted:#aab2c8; --accent:#ffd166; --hot:#ef476f; --ok:#06d6a0; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; color:var(--text); background: radial-gradient(circle at 20% 10%, rgba(255,209,102,.24), transparent 30%), radial-gradient(circle at 80% 0%, rgba(6,214,160,.18), transparent 26%), var(--bg); }
    main { width:min(1120px, calc(100vw - 32px)); margin:0 auto; padding:36px 0 48px; }
    header { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; margin-bottom:24px; }
    h1 { margin:0; font-size:clamp(32px, 6vw, 68px); letter-spacing:-.06em; line-height:.9; }
    .subtitle { color:var(--muted); max-width:560px; line-height:1.7; }
    .panel { border:1px solid var(--line); background:var(--card); backdrop-filter: blur(18px); border-radius:24px; padding:20px; box-shadow:0 24px 80px rgba(0,0,0,.28); }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:18px; }
    label { display:grid; gap:8px; color:var(--muted); font-size:13px; }
    input, select, button { border:1px solid var(--line); border-radius:14px; padding:11px 12px; font:inherit; color:var(--text); background:rgba(0,0,0,.24); }
    button { cursor:pointer; background:linear-gradient(135deg, rgba(255,209,102,.92), rgba(239,71,111,.9)); color:#111827; border:0; font-weight:800; }
    button.secondary { background:rgba(255,255,255,.1); color:var(--text); border:1px solid var(--line); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-bottom:18px; }
    .mascots { display:grid; gap:14px; margin-top:18px; }
    .mascot { display:grid; grid-template-columns: 1.2fr 1fr 1fr .8fr auto auto; gap:10px; align-items:end; padding:14px; border:1px solid var(--line); border-radius:18px; background:rgba(0,0,0,.18); }
    .id { color:var(--accent); font-weight:800; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .status { min-height:24px; color:var(--muted); margin-top:14px; }
    @media (max-width: 820px) { header, .grid, .mascot { grid-template-columns:1fr; display:grid; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>看板娘控制台</h1><p class="subtitle">新增看板娘、选择每只看板娘的形象、修改下方文本，并统一或单独切换动作状态。</p></div>
      <button id="refresh" class="secondary">刷新状态</button>
    </header>
    <section class="panel">
      <div class="toolbar">
        <label>所有看板娘动作状态<select id="globalStatus"></select></label>
        <button id="applyGlobal">应用到所有可见看板娘</button>
      </div>
      <div class="grid">
        <label>新增 ID<input id="newId" placeholder="例如 mascot-3"></label>
        <label>下方文本<input id="newName" placeholder="例如 小助手"></label>
        <label>形象<select id="newTheme"></select></label>
        <label>初始动作<select id="newStatus"></select></label>
      </div>
      <p><button id="addMascot">新增看板娘</button></p>
      <div id="mascots" class="mascots"></div>
      <div id="message" class="status"></div>
    </section>
  </main>
  <script>
    const statuses = ${JSON.stringify(STATUSES)};
    const $ = (id) => document.getElementById(id);
    let themes = [];
    function setMessage(text) { $('message').textContent = text; }
    async function api(path, options) {
      const response = await fetch(path, options);
      const body = await response.json();
      if (!response.ok || body.ok === false) throw new Error(body.message || body.code || '请求失败');
      return body;
    }
    function fillSelect(select, values, selected) {
      select.replaceChildren(...values.map((value) => {
        const option = document.createElement('option'); option.value = value; option.textContent = value; option.selected = value === selected; return option;
      }));
    }
    async function loadThemes() { themes = (await api('/themes')).themes; fillSelect($('newTheme'), themes, themes[0]); }
    function renderCharacters(characters) {
      const root = $('mascots'); root.replaceChildren();
      for (const character of characters) {
        const row = document.createElement('article'); row.className = 'mascot';
        row.innerHTML = '<div><div class="id"></div><label>下方文本<input class="name"></label></div><label>形象<select class="theme"></select></label><label>动作状态<select class="statusSelect"></select></label><label>大小<input class="width" type="range" min="96" max="320" step="8"></label><label>显示<select class="visible"><option value="true">显示</option><option value="false">隐藏</option></select></label><button class="save">保存</button><button class="delete secondary">删除</button>';
        row.querySelector('.id').textContent = character.id;
        row.querySelector('.name').value = character.name;
        fillSelect(row.querySelector('.theme'), themes, character.theme);
        fillSelect(row.querySelector('.statusSelect'), statuses, character.status);
        row.querySelector('.width').value = String(character.width || 180);
        row.querySelector('.visible').value = String(character.visible);
        row.querySelector('.save').addEventListener('click', async () => {
          await api('/characters/' + encodeURIComponent(character.id), { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: row.querySelector('.name').value, theme: row.querySelector('.theme').value, status: row.querySelector('.statusSelect').value, width: Number.parseFloat(row.querySelector('.width').value), visible: row.querySelector('.visible').value === 'true' }) });
          setMessage('已保存 ' + character.id); await refresh();
        });
        row.querySelector('.delete').addEventListener('click', async () => {
          if (!confirm('确定删除 ' + character.id + ' 吗？')) return;
          await api('/characters/' + encodeURIComponent(character.id), { method:'DELETE' });
          setMessage('已删除 ' + character.id); await refresh();
        });
        root.append(row);
      }
    }
    async function refresh() { const body = await api('/status'); renderCharacters(body.state.characters); }
    async function init() {
      fillSelect($('globalStatus'), statuses, 'idle'); fillSelect($('newStatus'), statuses, 'idle'); await loadThemes(); await refresh();
      $('refresh').onclick = refresh;
      $('applyGlobal').onclick = async () => { await api('/status', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ status: $('globalStatus').value }) }); setMessage('已切换所有可见看板娘动作'); await refresh(); };
      $('addMascot').onclick = async () => { await api('/characters', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id:$('newId').value, name:$('newName').value, theme:$('newTheme').value, status:$('newStatus').value }) }); setMessage('已新增看板娘'); await refresh(); };
    }
    init().catch((error) => setMessage(error.message));
  </script>
</body>
</html>`;
}

function createHttpServer({ store, onStateChange = () => {}, onCharacterPreferenceChange = null, listThemes = defaultListThemes, integrations = {}, opencode = integrations.opencode || null } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const method = req.method || 'GET';

    if (method === 'GET' && url.pathname === '/') {
      sendHtml(res, 200, createControlPage());
      return;
    }

    if (method === 'GET' && url.pathname === '/api/help') {
      sendJson(res, 200, createApiHelp({ integrations }));
      return;
    }

    if (method === 'GET' && url.pathname === '/themes') {
      sendJson(res, 200, { ok: true, themes: listThemes() });
      return;
    }

    if (method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, { ok: true, state: store.getState() });
      return;
    }

    if (method === 'GET' && url.pathname === '/opencode/state') {
      if (!opencode || typeof opencode.getSnapshot !== 'function') {
        sendJson(res, 503, { ok: false, code: 'OPENCODE_DISABLED' });
        return;
      }

      sendJson(res, 200, { ok: true, opencode: opencode.getSnapshot() });
      return;
    }

    if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND' });
      return;
    }

    const parsedBody = await readJsonBody(req);

    if (!parsedBody.ok) {
      sendJson(res, 400, { ok: false, code: parsedBody.code });
      return;
    }

    if (url.pathname.startsWith('/opencode/')) {
      if (!opencode) {
        sendJson(res, 503, { ok: false, code: 'OPENCODE_DISABLED' });
        return;
      }

      const routeMap = {
        '/opencode/client/hello': 'hello',
        '/opencode/client/heartbeat': 'heartbeat',
        '/opencode/client/disconnect': 'disconnect',
        '/opencode/event': 'handleEvent'
      };
      const handlerName = routeMap[url.pathname];

      if (method === 'POST' && handlerName && typeof opencode[handlerName] === 'function') {
        const result = opencode[handlerName](parsedBody.body);
        if (!result.ok) {
          sendJson(res, 400, { ok: false, code: result.code || 'BAD_REQUEST', message: result.message });
          return;
        }

        sendJson(res, 200, { ok: true, result, state: store.getState() });
        return;
      }
    }

    if (method === 'POST' && url.pathname === '/characters') {
      const result = store.addCharacter(parsedBody.body);

      if (!result.ok) {
        sendJson(res, 400, { ok: false, code: result.code, message: result.message });
        return;
      }

      if (hasOwn(parsedBody.body, 'status')) {
        const statusResult = store.setCharacterStatus(result.character.id, parsedBody.body.status);
        if (!statusResult.ok) {
          sendJson(res, 400, { ok: false, code: statusResult.code, message: statusResult.message });
          return;
        }
      }

      const state = store.getState();
      onStateChange(state);
      sendJson(res, 200, { ok: true, state });
      return;
    }

    const patchMatch = url.pathname.match(/^\/characters\/([^/]+)$/);
    if (method === 'PATCH' && patchMatch) {
      const persistedPatch = pickPersistedCharacterPatch(parsedBody.body);

      if (onCharacterPreferenceChange && hasPersistedCharacterPatch(persistedPatch)) {
        const persistenceResult = onCharacterPreferenceChange(patchMatch[1], persistedPatch);

        if (!persistenceResult || persistenceResult.ok !== true) {
          sendJson(res, 400, {
            ok: false,
            code: persistenceResult?.code || 'PERSISTENCE_FAILED',
            message: persistenceResult?.message
          });
          return;
        }
      }

      const result = store.updateCharacter(patchMatch[1], parsedBody.body);

      if (!result.ok) {
        const statusCode = result.code === 'UNKNOWN_CHARACTER' ? 404 : 400;
        sendJson(res, statusCode, { ok: false, code: result.code, message: result.message });
        return;
      }

      const state = store.getState();
      onStateChange(state);
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (method === 'DELETE' && patchMatch) {
      const result = store.removeCharacter(patchMatch[1]);

      if (!result.ok) {
        const statusCode = result.code === 'UNKNOWN_CHARACTER' ? 404 : 400;
        sendJson(res, statusCode, { ok: false, code: result.code, message: result.message });
        return;
      }

      const state = store.getState();
      onStateChange(state);
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (method === 'POST' && url.pathname === '/status') {
      const validatedStatus = validateStringField(parsedBody.body, 'status');

      if (!validatedStatus.ok) {
        sendJson(res, validatedStatus.statusCode, {
          ok: false,
          code: validatedStatus.code,
          message: validatedStatus.message
        });
        return;
      }

      const result = store.setGlobalStatus(validatedStatus.value);

      if (!result.ok) {
        const statusCode = result.code === 'UNKNOWN_CHARACTER' ? 404 : 400;
        sendJson(res, statusCode, { ok: false, code: result.code, message: result.message });
        return;
      }

      const state = store.getState();
      onStateChange(state);
      sendJson(res, 200, { ok: true, state });
      return;
    }

    const statusMatch = url.pathname.match(/^\/characters\/([^/]+)\/status$/);
    if (method === 'POST' && statusMatch) {
      const validatedStatus = validateStringField(parsedBody.body, 'status');

      if (!validatedStatus.ok) {
        sendJson(res, validatedStatus.statusCode, {
          ok: false,
          code: validatedStatus.code,
          message: validatedStatus.message
        });
        return;
      }

      const result = store.setCharacterStatus(statusMatch[1], validatedStatus.value);

      if (!result.ok) {
        const statusCode = result.code === 'UNKNOWN_CHARACTER' ? 404 : 400;
        sendJson(res, statusCode, { ok: false, code: result.code, message: result.message });
        return;
      }

      const state = store.getState();
      onStateChange(state);
      sendJson(res, 200, { ok: true, state });
      return;
    }

    const visibilityMatch = url.pathname.match(/^\/characters\/([^/]+)\/visibility$/);
    if (method === 'POST' && visibilityMatch) {
      const validatedVisible = validateBooleanField(parsedBody.body, 'visible');

      if (!validatedVisible.ok) {
        sendJson(res, validatedVisible.statusCode, {
          ok: false,
          code: validatedVisible.code,
          message: validatedVisible.message
        });
        return;
      }

      const result = store.setCharacterVisibility(visibilityMatch[1], validatedVisible.value);

      if (!result.ok) {
        const statusCode = result.code === 'UNKNOWN_CHARACTER' ? 404 : 400;
        sendJson(res, statusCode, { ok: false, code: result.code, message: result.message });
        return;
      }

      const state = store.getState();
      onStateChange(state);
      sendJson(res, 200, { ok: true, state });
      return;
    }

    sendJson(res, 404, { ok: false, code: 'NOT_FOUND' });
  });
}

module.exports = {
  createApiHelp,
  createControlPage,
  createHttpServer,
  defaultListThemes
};
