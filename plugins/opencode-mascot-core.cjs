const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MASCOT_URL = 'http://127.0.0.1:17890';
const DEFAULT_HEARTBEAT_MS = 2_000;

function defaultConfigPath() {
  return path.join(os.homedir(), '.config', 'opencode', 'mascot.json');
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

function normalizeConfig(raw = {}, env = process.env) {
  const startOptions = raw.startOptions && typeof raw.startOptions === 'object' && !Array.isArray(raw.startOptions) ? raw.startOptions : {};
  return {
    enabled: env.OPENCODE_MASCOT_DISABLE === '1' ? false : raw.enabled !== false,
    autoStart: raw.autoStart !== false,
    mascotUrl: typeof raw.mascotUrl === 'string' && raw.mascotUrl.trim() ? raw.mascotUrl.trim().replace(/\/+$/, '') : DEFAULT_MASCOT_URL,
    startCommand: Array.isArray(raw.startCommand) ? raw.startCommand.filter((part) => typeof part === 'string' && part) : [],
    startOptions: {
      cwd: typeof startOptions.cwd === 'string' && startOptions.cwd.trim() ? startOptions.cwd.trim() : undefined
    },
    heartbeatMs: Number.isFinite(raw.heartbeatMs) && raw.heartbeatMs >= 500 ? raw.heartbeatMs : DEFAULT_HEARTBEAT_MS
  };
}

function getProjectContext(input = {}) {
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const directory = typeof input.directory === 'string' && input.directory ? input.directory : typeof input.cwd === 'string' && input.cwd ? input.cwd : '';
  const projectPath = typeof input.project === 'string'
    ? input.project
    : typeof input.projectPath === 'string'
      ? input.projectPath
      : typeof input.project?.worktree === 'string'
        ? input.project.worktree
        : '';
  const worktreePath = typeof input.worktree === 'string'
    ? input.worktree
    : typeof input.worktreePath === 'string'
      ? input.worktreePath
      : projectPath;
  return {
    project: directory || projectPath || cwd,
    worktree: directory || worktreePath || projectPath || cwd,
    serverUrl: input.serverUrl || input.server || ''
  };
}

function postJson(fetchImpl, mascotUrl, route, body) {
  return fetchImpl(`${mascotUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function startMascot(command, execFileImpl = execFile, startOptions = {}) {
  if (!command.length) {
    return false;
  }

  const [file, ...args] = command;
  const child = execFileImpl(file, args, {
    cwd: startOptions.cwd,
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child?.unref?.();
  return true;
}

function createMascotPlugin({
  clientID = `opencode-${randomUUID()}`,
  configPath = defaultConfigPath(),
  fetch: fetchImpl = globalThis.fetch,
  execFile: execFileImpl = execFile,
  setInterval: setIntervalImpl = setInterval,
  clearInterval: clearIntervalImpl = clearInterval,
  now = () => Date.now(),
  context = {}
} = {}) {
  const config = normalizeConfig(readJsonFile(configPath));
  const projectContext = getProjectContext(context);
  let startedMascot = false;
  let heartbeatTimer = null;

  function buildEnvelope(extra = {}) {
    return {
      clientID,
      project: projectContext.project,
      worktree: projectContext.worktree,
      serverUrl: projectContext.serverUrl,
      timestamp: now(),
      ...extra
    };
  }

  async function send(route, body) {
    if (!config.enabled || typeof fetchImpl !== 'function') {
      return { ok: false, skipped: true };
    }

    try {
      return await postJson(fetchImpl, config.mascotUrl, route, body);
    } catch (error) {
      if (config.autoStart && !startedMascot) {
        startedMascot = startMascot(config.startCommand, execFileImpl, config.startOptions);
      }
      return { ok: false, error };
    }
  }

  async function hello() {
    return send('/opencode/client/hello', buildEnvelope());
  }

  async function heartbeat() {
    return send('/opencode/client/heartbeat', buildEnvelope());
  }

  async function disconnect() {
    if (heartbeatTimer) {
      clearIntervalImpl(heartbeatTimer);
      heartbeatTimer = null;
    }

    return send('/opencode/client/disconnect', buildEnvelope());
  }

  async function forwardEvent(event) {
    return send('/opencode/event', buildEnvelope({
      eventType: event?.type || event?.event || event?.name || 'unknown',
      payload: event
    }));
  }

  async function initialize() {
    if (!config.enabled) {
      return;
    }

    await hello();
    heartbeatTimer = setIntervalImpl(() => {
      heartbeat();
    }, config.heartbeatMs);
    heartbeatTimer?.unref?.();
  }

  return {
    event: async ({ event }) => {
      await forwardEvent(event);
    },
    initialize,
    shutdown: disconnect,
    _internal: {
      buildEnvelope,
      config,
      disconnect,
      forwardEvent,
      heartbeat,
      hello,
      projectContext
    }
  };
}

async function MascotPlugin(input = {}) {
  const plugin = createMascotPlugin({ context: input });
  await plugin.initialize();
  return {
    event: plugin.event
  };
}

module.exports = {
  MascotPlugin,
  createMascotPlugin,
  normalizeConfig,
  startMascot
};
