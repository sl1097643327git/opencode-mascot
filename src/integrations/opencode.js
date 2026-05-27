const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OPENCODE_PROJECTS_FILE_NAME = 'opencode-projects.json';
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 3_000;
const SAME_PROJECT_OFFSET = 36;
const DEFAULT_CHARACTER_WIDTH = 180;
const DEFAULT_DONE_MS = 2_500;
const THINKING_FALLBACK_MS = 5_000;
const TYPING_FALLBACK_MS = 4_000;
const TOOL_FALLBACK_MS = 30_000;

function hasOwn(object, property) {
  return Object.hasOwn(object, property);
}

function normalizeProjectPath(projectPath) {
  const raw = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : 'unknown-project';
  const normalized = path.normalize(raw.replace(/[\\/]+$/, ''));
  return normalized.replace(/^([a-z]):/, (_match, drive) => `${drive.toUpperCase()}:`);
}

function projectKeyFor(projectPath) {
  const normalized = normalizeProjectPath(projectPath).toLowerCase();
  const digest = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
  return `proj_${digest}`;
}

function characterIdForClient(clientID) {
  return `opencode-${clientID.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 48);
}

function displayNameForProject(projectPath) {
  const normalized = normalizeProjectPath(projectPath);
  return path.basename(normalized) || normalized;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizeTheme(theme, themes, fallbackTheme = 'default') {
  if (!Array.isArray(themes) || themes.length === 0) {
    return theme || fallbackTheme;
  }

  if (themes.includes(theme)) {
    return theme;
  }

  if (themes.includes(fallbackTheme)) {
    return fallbackTheme;
  }

  return themes[0];
}

function sanitizeProjectPreference(preference) {
  if (!preference || typeof preference !== 'object' || Array.isArray(preference)) {
    return null;
  }

  const sanitized = {};

  if (typeof preference.projectPath === 'string' && preference.projectPath.trim()) {
    sanitized.projectPath = normalizeProjectPath(preference.projectPath);
  }

  if (typeof preference.displayName === 'string' && preference.displayName.trim()) {
    sanitized.displayName = preference.displayName.trim();
  }

  if (typeof preference.theme === 'string' && preference.theme.trim()) {
    sanitized.theme = preference.theme.trim();
  }

  if (isFiniteNumber(preference.x)) {
    sanitized.x = preference.x;
  }

  if (isFiniteNumber(preference.y)) {
    sanitized.y = preference.y;
  }

  if (isFiniteNumber(preference.width) && preference.width > 0) {
    sanitized.width = preference.width;
  }

  if (typeof preference.showStatus === 'boolean') {
    sanitized.showStatus = preference.showStatus;
  }

  if (isFiniteNumber(preference.lastUsedAt)) {
    sanitized.lastUsedAt = preference.lastUsedAt;
  }

  return sanitized;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
      return {};
    }

    if (error instanceof SyntaxError) {
      return {};
    }

    throw error;
  }
}

function writeJsonFileAtomic(filePath, payload) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(directory, `${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(8).toString('hex')}`);
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function createOpencodeProjectStore({ userDataPath }) {
  const projectsPath = path.join(userDataPath, OPENCODE_PROJECTS_FILE_NAME);

  function readProjects() {
    const raw = readJsonFile(projectsPath);
    const projects = {};

    for (const [projectKey, preference] of Object.entries(raw)) {
      if (!/^proj_[a-f0-9]{12}$/.test(projectKey)) {
        continue;
      }

      const sanitized = sanitizeProjectPreference(preference);
      if (sanitized) {
        projects[projectKey] = sanitized;
      }
    }

    return projects;
  }

  function saveProject(projectKey, patch) {
    const projects = readProjects();
    const next = sanitizeProjectPreference({
      ...(projects[projectKey] || {}),
      ...patch
    });
    projects[projectKey] = next || {};
    writeJsonFileAtomic(projectsPath, projects);
    return { ok: true, project: projects[projectKey] };
  }

  return {
    getProject(projectKey) {
      return readProjects()[projectKey];
    },
    readProjects,
    saveProject
  };
}

function mapOpencodeEventToDisplay({ eventType, payload = {} }) {
  const properties = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.properties && typeof payload.properties === 'object'
    ? payload.properties
    : payload;

  if (eventType === 'session.status') {
    const statusType = properties.status?.type;
    if (statusType === 'idle') {
      return { status: 'idle', label: '空闲中' };
    }
    if (statusType === 'busy') {
      return { status: 'working', label: '正在工作…' };
    }
    if (statusType === 'retry') {
      return { status: 'error', label: properties.status.message ? `正在重试：${properties.status.message}` : '正在重试…' };
    }
  }

  if (eventType === 'session.idle') {
    return { status: 'done', label: '完成啦' };
  }

  if (eventType === 'session.error') {
    return { status: 'error', label: 'opencode 出错了' };
  }

  if (eventType === 'permission.asked' || eventType === 'permission.updated') {
    return { status: 'permission', label: '等待你的授权' };
  }

  if (eventType === 'permission.replied') {
    return { status: 'working', label: '继续工作…' };
  }

  if (eventType === 'tool.execute.before') {
    const tool = typeof properties.tool === 'string' ? properties.tool : '工具';
    return { status: 'tool', label: `正在执行 ${tool}` };
  }

  if (eventType === 'tool.execute.after') {
    return { status: 'working', label: '正在工作…' };
  }

  if (eventType === 'message.part.updated') {
    const part = properties.part || {};
    if (part.type === 'reasoning') {
      return { status: 'thinking', label: '正在思考…' };
    }
    if (part.type === 'text') {
      return { status: 'typing', label: '正在回复…' };
    }
    if (part.type === 'tool') {
      if (part.state?.status === 'error') {
        return { status: 'error', label: '工具执行失败' };
      }
      if (part.state?.status === 'running') {
        return { status: 'tool', label: part.tool ? `正在执行 ${part.tool}` : '正在执行工具' };
      }
    }
  }

  return null;
}

function createOpencodeIntegration({
  store,
  projectStore,
  listThemes = () => ['default'],
  onStateChange = () => {},
  now = () => Date.now(),
  staleAfterMs = DEFAULT_HEARTBEAT_TIMEOUT_MS
}) {
  const clients = new Map();

  function broadcast() {
    onStateChange(store.getState());
  }

  function getSameProjectIndex(projectKey, clientID) {
    return Array.from(clients.values())
      .filter((client) => client.projectKey === projectKey)
      .sort((left, right) => left.startedAt - right.startedAt)
      .findIndex((client) => client.clientID === clientID);
  }

  function buildCharacter(client) {
    const themes = listThemes();
    const preference = projectStore.getProject(client.projectKey) || {};
    const projectPath = normalizeProjectPath(client.worktree || client.project);
    const sameProjectIndex = Math.max(0, getSameProjectIndex(client.projectKey, client.clientID));
    const offset = sameProjectIndex * SAME_PROJECT_OFFSET;
    const preferredTheme = preference.theme || themes[Math.abs(parseInt(client.projectKey.slice(-6), 16)) % Math.max(1, themes.length)] || 'default';
    const theme = normalizeTheme(preferredTheme, themes, 'default');
    const baseX = isFiniteNumber(preference.x) ? preference.x : 400 + clients.size * 200;
    const baseY = isFiniteNumber(preference.y) ? preference.y : 0;

    return {
      id: client.characterID,
      name: preference.displayName || displayNameForProject(projectPath),
      integrationDetail: `opencode 目录：${projectPath}`,
      theme,
      status: client.displayStatus || 'idle',
      showStatus: preference.showStatus !== false,
      visible: true,
      x: baseX - offset,
      y: baseY - offset,
      width: preference.width || DEFAULT_CHARACTER_WIDTH,
      zIndex: store.getState().characters.length + 1
    };
  }

  function validateClientPayload(payload) {
    if (!payload || typeof payload.clientID !== 'string' || !payload.clientID.trim()) {
      return { ok: false, code: 'BAD_REQUEST', message: 'Expected string field: clientID' };
    }

    return { ok: true };
  }

  function ensureClient(payload) {
    const validation = validateClientPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const clientID = payload.clientID.trim();
    const projectPath = normalizeProjectPath(payload.worktree || payload.project || 'unknown-project');
    const projectKey = projectKeyFor(projectPath);
    let client = clients.get(clientID);

    if (!client) {
      client = {
        clientID,
        characterID: characterIdForClient(clientID),
        project: payload.project || projectPath,
        worktree: payload.worktree || payload.project || projectPath,
        projectKey,
        serverUrl: payload.serverUrl || '',
        startedAt: payload.startedAt || now(),
        lastSeenAt: now(),
        lastEventAt: now(),
        sessionStatus: 'idle',
        displayStatus: 'idle',
        label: null,
        timers: {}
      };
      clients.set(clientID, client);
    } else {
      client.lastSeenAt = now();
      client.project = payload.project || client.project;
      client.worktree = payload.worktree || client.worktree;
      client.serverUrl = payload.serverUrl || client.serverUrl;
    }

    return { ok: true, client };
  }

  function applyClientToCharacter(client) {
    const existing = store.getState().characters.find((character) => character.id === client.characterID);
    const preference = projectStore.getProject(client.projectKey) || {};
    const label = client.label || preference.displayName || displayNameForProject(client.worktree || client.project);

    if (!existing) {
      const result = store.addCharacter(buildCharacter(client));
      if (!result.ok) {
        return result;
      }
    }

    const character = buildCharacter(client);
    return store.updateCharacter(client.characterID, {
      name: label,
      integrationDetail: character.integrationDetail,
      theme: normalizeTheme(preference.theme || existing?.theme || character.theme, listThemes(), 'default'),
      status: client.displayStatus || character.status,
      showStatus: preference.showStatus !== false,
      visible: true,
      x: character.x,
      y: character.y,
      width: character.width,
      zIndex: character.zIndex
    });
  }

  function setDisplay(client, status) {
    client.displayStatus = status;
    client.label = null;
    const result = applyClientToCharacter(client);
    if (result.ok) {
      broadcast();
    }
    return result;
  }

  function hello(payload) {
    const ensured = ensureClient(payload);
    if (!ensured.ok) {
      return ensured;
    }

    const client = ensured.client;
    const projectPath = normalizeProjectPath(client.worktree || client.project);
    const existingPreference = projectStore.getProject(client.projectKey);
    if (!existingPreference) {
      projectStore.saveProject(client.projectKey, {
        projectPath,
        displayName: displayNameForProject(projectPath),
        lastUsedAt: now()
      });
    }

    const characterResult = applyClientToCharacter(client);
    if (!characterResult.ok) {
      return characterResult;
    }

    broadcast();
    const character = store.getState().characters.find((entry) => entry.id === client.characterID);
    return { ok: true, client: { ...client }, character };
  }

  function heartbeat(payload) {
    const ensured = ensureClient(payload);
    if (!ensured.ok) {
      return ensured;
    }

    ensured.client.lastSeenAt = now();
    return { ok: true };
  }

  function disconnect(payload) {
    const validation = validateClientPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const client = clients.get(payload.clientID);
    if (!client) {
      return { ok: true };
    }

    clients.delete(payload.clientID);
    store.removeCharacter(client.characterID);
    broadcast();
    return { ok: true };
  }

  function handleEvent(payload) {
    const ensured = ensureClient(payload);
    if (!ensured.ok) {
      return ensured;
    }

    const client = ensured.client;
    client.lastEventAt = now();
    client.lastSeenAt = now();
    const display = mapOpencodeEventToDisplay(payload);
    if (!display) {
      return { ok: true, ignored: true };
    }

    if (payload.eventType === 'session.status') {
      client.sessionStatus = payload.payload?.properties?.status?.type || payload.payload?.status?.type || client.sessionStatus;
    }

    if (display.status === 'thinking') {
      client.timers.thinkingUntil = now() + THINKING_FALLBACK_MS;
    }
    if (display.status === 'typing') {
      client.timers.typingUntil = now() + TYPING_FALLBACK_MS;
    }
    if (display.status === 'tool') {
      client.timers.toolUntil = now() + TOOL_FALLBACK_MS;
    }
    if (display.status === 'done') {
      client.timers.doneUntil = now() + DEFAULT_DONE_MS;
      client.sessionStatus = 'idle';
    }

    return setDisplay(client, display.status);
  }

  function tickTimers() {
    const currentTime = now();
    for (const client of clients.values()) {
      if (client.displayStatus === 'thinking' && currentTime > client.timers.thinkingUntil && client.sessionStatus !== 'idle') {
        setDisplay(client, 'working');
      }
      if (client.displayStatus === 'typing' && currentTime > client.timers.typingUntil && client.sessionStatus !== 'idle') {
        setDisplay(client, 'working');
      }
      if (client.displayStatus === 'tool' && currentTime > client.timers.toolUntil && client.sessionStatus !== 'idle') {
        setDisplay(client, 'working');
      }
      if (client.displayStatus === 'done' && currentTime > client.timers.doneUntil) {
        setDisplay(client, 'idle');
      }
    }
  }

  function removeStaleClients() {
    const removed = [];
    const currentTime = now();
    for (const client of Array.from(clients.values())) {
      if (currentTime - client.lastSeenAt <= staleAfterMs) {
        continue;
      }
      clients.delete(client.clientID);
      store.removeCharacter(client.characterID);
      removed.push(client.clientID);
    }
    if (removed.length) {
      broadcast();
    }
    return { ok: true, removed };
  }

  function updateProjectPreferenceForCharacter(characterID, patch) {
    const client = Array.from(clients.values()).find((entry) => entry.characterID === characterID);
    if (!client) {
      return { ok: false, code: 'UNKNOWN_CLIENT' };
    }

    const sameProjectIndex = Math.max(0, getSameProjectIndex(client.projectKey, client.clientID));
    const offset = sameProjectIndex * SAME_PROJECT_OFFSET;
    const preferencePatch = {
      lastUsedAt: now()
    };

    if (hasOwn(patch, 'theme')) {
      preferencePatch.theme = patch.theme;
    }
    if (hasOwn(patch, 'width')) {
      preferencePatch.width = patch.width;
    }
    if (hasOwn(patch, 'showStatus')) {
      preferencePatch.showStatus = patch.showStatus;
    }
    if (hasOwn(patch, 'displayName')) {
      preferencePatch.displayName = patch.displayName;
    }
    if (hasOwn(patch, 'name')) {
      preferencePatch.displayName = patch.name;
    }
    if (hasOwn(patch, 'x')) {
      preferencePatch.x = patch.x + offset;
    }
    if (hasOwn(patch, 'y')) {
      preferencePatch.y = patch.y + offset;
    }

    return projectStore.saveProject(client.projectKey, preferencePatch);
  }

  function getSnapshot() {
    const clientsSnapshot = {};
    for (const [clientID, client] of clients.entries()) {
      clientsSnapshot[clientID] = {
        clientID: client.clientID,
        characterID: client.characterID,
        project: client.project,
        worktree: client.worktree,
        projectKey: client.projectKey,
        serverUrl: client.serverUrl,
        startedAt: client.startedAt,
        lastSeenAt: client.lastSeenAt,
        lastEventAt: client.lastEventAt,
        sessionStatus: client.sessionStatus,
        displayStatus: client.displayStatus
      };
    }

    return {
      clients: clientsSnapshot,
      projects: projectStore.readProjects()
    };
  }

  return {
    disconnect,
    getSnapshot,
    handleEvent,
    heartbeat,
    hello,
    removeStaleClients,
    tickTimers,
    updateProjectPreferenceForCharacter
  };
}

module.exports = {
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  OPENCODE_PROJECTS_FILE_NAME,
  characterIdForClient,
  createOpencodeIntegration,
  createOpencodeProjectStore,
  displayNameForProject,
  mapOpencodeEventToDisplay,
  normalizeProjectPath,
  normalizeTheme,
  projectKeyFor
};
