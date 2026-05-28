const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pluginModule = require('../plugins/opencode-mascot');
const MascotPlugin = pluginModule.server;
const { createMascotPlugin, normalizeConfig, startMascot } = require('../plugins/opencode-mascot-core.cjs');
const { createStartConfig, install, ensurePluginConfigured, installDependenciesIfNeeded } = require('../scripts/install-opencode-plugin');
const { launch } = require('../scripts/launch-mascot-detached');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-plugin-test-'));
}

test('normalizeConfig supports disable env and safe defaults', () => {
  const config = normalizeConfig({ mascotUrl: 'http://127.0.0.1:17890/', heartbeatMs: 100, startOptions: { cwd: '/tmp/mascot' } }, { OPENCODE_MASCOT_DISABLE: '1' });

  assert.equal(config.enabled, false);
  assert.equal(config.mascotUrl, 'http://127.0.0.1:17890');
  assert.equal(config.heartbeatMs, 2000);
  assert.equal(config.startOptions.cwd, '/tmp/mascot');
});

test('createStartConfig uses platform-specific mascot launch commands', () => {
  const expected = {
    startCommand: [process.execPath, path.join('D:\\Mascot', 'scripts', 'launch-mascot-detached.js'), 'D:\\Mascot']
  };
  assert.deepEqual(createStartConfig('D:\\Mascot', 'win32'), {
    startCommand: expected.startCommand
  });
  assert.deepEqual(createStartConfig('/home/me/mascot', 'linux'), {
    startCommand: [process.execPath, path.join('/home/me/mascot', 'scripts', 'launch-mascot-detached.js'), '/home/me/mascot']
  });
});

test('launch starts npm detached from a project root and returns immediately', () => {
  const tempRoot = createTempDir();
  const electronBin = process.platform === 'win32'
    ? path.join(tempRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(tempRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"scripts":{"start":"echo ok"}}');
  fs.mkdirSync(path.dirname(electronBin), { recursive: true });
  fs.writeFileSync(electronBin, '');
  const calls = [];
  const result = launch({
    projectRoot: tempRoot,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { pid: 123, unref() { calls.push({ unref: true }); } };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].command, electronBin);
  assert.equal(calls[0].args[0], '.');
  assert.equal(calls[0].options.cwd, tempRoot);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.deepEqual(calls[1], { unref: true });
});

test('plugin sends hello, heartbeat, event, and disconnect envelopes', async () => {
  const tempDir = createTempDir();
  const configPath = path.join(tempDir, 'mascot.json');
  fs.writeFileSync(configPath, JSON.stringify({ enabled: true, autoStart: false, heartbeatMs: 1000 }));
  const calls = [];
  const timers = [];
  const plugin = createMascotPlugin({
    clientID: 'client-test',
    configPath,
    context: { project: 'D:\\Project', worktree: 'D:\\Project', serverUrl: 'http://127.0.0.1:4096' },
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true };
    },
    setInterval: (callback, ms) => {
      timers.push({ callback, ms });
      return { unref() {} };
    },
    clearInterval: () => {},
    now: () => 123
  });

  await plugin.initialize();
  await timers[0].callback();
  await plugin.event({ event: { type: 'session.status', status: { type: 'busy' } } });
  await plugin.shutdown();

  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:17890/opencode/client/hello',
    'http://127.0.0.1:17890/opencode/client/heartbeat',
    'http://127.0.0.1:17890/opencode/event',
    'http://127.0.0.1:17890/opencode/client/disconnect'
  ]);
  assert.equal(calls[2].body.eventType, 'session.status');
  assert.equal(calls[2].body.clientID, 'client-test');
  assert.equal(timers[0].ms, 1000);
});

test('plugin prefers session directory over git worktree root for display context', async () => {
  const tempDir = createTempDir();
  const configPath = path.join(tempDir, 'mascot.json');
  fs.writeFileSync(configPath, JSON.stringify({ enabled: true, autoStart: false, heartbeatMs: 1000 }));
  const calls = [];
  const plugin = createMascotPlugin({
    clientID: 'client-directory',
    configPath,
    context: {
      directory: 'D:\\DESKTOP\\我的应用\\opencode\\kanban',
      project: { id: 'project-root', worktree: 'D:\\', vcs: 'git' },
      worktree: 'D:\\',
      serverUrl: 'http://127.0.0.1:4096'
    },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true };
    },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    now: () => 123
  });

  await plugin.initialize();

  assert.equal(calls[0].body.project, 'D:\\DESKTOP\\我的应用\\opencode\\kanban');
  assert.equal(calls[0].body.worktree, 'D:\\DESKTOP\\我的应用\\opencode\\kanban');
});

test('opencode module exports a plugin function without import-time side effects', async () => {
  assert.deepEqual(Object.keys(pluginModule), ['id', 'server']);
  assert.equal(pluginModule.id, 'mascot');
  assert.equal(typeof MascotPlugin, 'function');
});

test('plugin disabled by config does not call fetch', async () => {
  const tempDir = createTempDir();
  const configPath = path.join(tempDir, 'mascot.json');
  fs.writeFileSync(configPath, JSON.stringify({ enabled: false }));
  let fetchCalls = 0;
  const plugin = createMascotPlugin({
    configPath,
    fetch: async () => {
      fetchCalls += 1;
      return { ok: true };
    }
  });

  await plugin.initialize();
  await plugin.event({ event: { type: 'session.status' } });

  assert.equal(fetchCalls, 0);
});

test('plugin starts mascot once when HTTP bridge is offline', async () => {
  const tempDir = createTempDir();
  const configPath = path.join(tempDir, 'mascot.json');
  fs.writeFileSync(configPath, JSON.stringify({ enabled: true, autoStart: true, startCommand: ['cmd.exe', '/c', 'start-mascot.bat'] }));
  const execCalls = [];
  const plugin = createMascotPlugin({
    configPath,
    fetch: async () => {
      throw new Error('offline');
    },
    execFile: (file, args) => {
      execCalls.push({ file, args });
      return { unref() {} };
    },
    setInterval: () => ({ unref() {} })
  });

  await plugin.initialize();
  await plugin._internal.heartbeat();

  assert.deepEqual(execCalls, [{ file: 'cmd.exe', args: ['/c', 'start-mascot.bat'] }]);
});

test('startMascot returns false without command and detaches configured command', () => {
  assert.equal(startMascot([]), false);
  const calls = [];
  const result = startMascot(['node', 'server.js'], (file, args, options) => {
    calls.push({ file, args, options });
    return { unref() {} };
  }, { cwd: '/tmp/mascot' });

  assert.equal(result, true);
  assert.equal(calls[0].file, 'node');
  assert.deepEqual(calls[0].args, ['server.js']);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.cwd, '/tmp/mascot');
});

test('install copies plugin and creates default config without overwriting existing config', () => {
  const tempHome = createTempDir();
  const first = install({ homeDir: tempHome });
  const existing = '{"enabled":false}\n';
  fs.writeFileSync(first.configPath, existing);
  const second = install({ homeDir: tempHome });

  assert.equal(fs.existsSync(first.target), true);
  assert.equal(fs.existsSync(first.coreTarget), true);
  assert.equal(first.target, second.target);
  assert.equal(fs.readFileSync(second.configPath, 'utf8'), existing);
});

test('ensurePluginConfigured creates opencode.json with mascot plugin when missing', () => {
  const tempHome = createTempDir();
  const result = ensurePluginConfigured({
    homeDir: tempHome,
    pluginModulePath: 'C:\\Users\\demo\\.config\\opencode\\plugins\\mascot.js'
  });

  const configPath = path.join(tempHome, '.config', 'opencode', 'opencode.json');
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(result.updated, true);
  assert.deepEqual(saved.plugin, ['C:\\Users\\demo\\.config\\opencode\\plugins\\mascot.js']);
});

test('ensurePluginConfigured appends mascot plugin without removing existing plugin entries', () => {
  const tempHome = createTempDir();
  const configDir = path.join(tempHome, '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ plugin: ['existing-plugin.js'] }, null, 2)}\n`);

  const result = ensurePluginConfigured({
    homeDir: tempHome,
    pluginModulePath: 'C:\\Users\\demo\\.config\\opencode\\plugins\\mascot.js'
  });

  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(result.updated, true);
  assert.deepEqual(saved.plugin, ['existing-plugin.js', 'C:\\Users\\demo\\.config\\opencode\\plugins\\mascot.js']);
});

test('ensurePluginConfigured does not duplicate mascot plugin entry', () => {
  const tempHome = createTempDir();
  const configDir = path.join(tempHome, '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');
  const pluginModulePath = 'C:\\Users\\demo\\.config\\opencode\\plugins\\mascot.js';
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ plugin: [pluginModulePath] }, null, 2)}\n`);

  const result = ensurePluginConfigured({ homeDir: tempHome, pluginModulePath });
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(result.updated, false);
  assert.deepEqual(saved.plugin, [pluginModulePath]);
});

test('ensurePluginConfigured fails without overwriting malformed opencode.json', () => {
  const tempHome = createTempDir();
  const configDir = path.join(tempHome, '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, '{ invalid json\n');

  assert.throws(
    () => ensurePluginConfigured({
      homeDir: tempHome,
      pluginModulePath: 'C:\\Users\\demo\\.config\\opencode\\plugins\\mascot.js'
    }),
    /opencode\.json/i
  );
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{ invalid json\n');
});

test('installDependenciesIfNeeded skips install when Electron binary already exists', () => {
  const tempRoot = createTempDir();
  const electronBin = process.platform === 'win32'
    ? path.join(tempRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(tempRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}');
  fs.mkdirSync(path.dirname(electronBin), { recursive: true });
  fs.writeFileSync(electronBin, '');
  const calls = [];

  const result = installDependenciesIfNeeded({
    projectRoot: tempRoot,
    spawnSyncImpl: (...args) => {
      calls.push(args);
      return { status: 0 };
    }
  });

  assert.equal(result.installed, false);
  assert.equal(calls.length, 0);
});

test('installDependenciesIfNeeded runs npm install when Electron binary is missing', () => {
  const tempRoot = createTempDir();
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}');
  const calls = [];
  const electronBin = process.platform === 'win32'
    ? path.join(tempRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(tempRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

  const result = installDependenciesIfNeeded({
    projectRoot: tempRoot,
    spawnSyncImpl: (command, args, options) => {
      calls.push({ command, args, options });
      fs.mkdirSync(path.dirname(electronBin), { recursive: true });
      fs.writeFileSync(electronBin, '');
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result.installed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  assert.deepEqual(calls[0].args, ['install']);
  assert.equal(calls[0].options.cwd, tempRoot);
});
