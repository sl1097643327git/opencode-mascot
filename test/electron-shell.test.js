const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { DEFAULT_CHARACTERS } = require('../src/character-config');
const { HOST, PORT } = require('../src/constants');
const { createStateStore } = require('../src/state-store');
const {
  createBroadcastState,
  createLifecycle,
  createMouseIgnoreController,
  clampCharacterToWorkArea,
  getBrowserWindowOptions,
  enforceTopMostWindow,
  getIndexHtmlPath,
  MOUSE_EVENTS_CHANNEL,
  GET_FRAMES_CHANNEL,
  GET_THEMES_CHANNEL,
  UPDATE_CHARACTER_CHANNEL,
  DELETE_CHARACTER_CHANNEL,
  UPDATE_POSITION_CHANNEL,
  acquireSingleInstanceLock,
  getAssetsRoot,
  registerFrameHandler,
  registerCharacterManagementHandlers,
  registerPositionHandler,
  shouldBootstrap
} = require('../src/main');
const {
  buildCharacterAssetPath,
  clearStage,
  initRenderer,
  resetFailedAssetPaths,
  renderFrameFallback,
  renderState,
  startFramePlayer,
  stopFramePlayer
} = require('../src/renderer');

test.beforeEach(() => {
  resetFailedAssetPaths();
});

test('shouldBootstrap starts only in Electron runtime', () => {
  assert.equal(shouldBootstrap({ versions: { electron: '31.7.7' } }), true);
  assert.equal(shouldBootstrap({ versions: { node: process.versions.node } }), false);
  assert.equal(shouldBootstrap({}), false);
});

test('styles enable pointer interaction and grab cursors for mascot dragging', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(styles, /#mascot-stage\s*\{[^}]*pointer-events:\s*auto;/s);
  assert.doesNotMatch(styles, /pointer-events:\s*none;/);
  assert.doesNotMatch(styles, /Click-through is intentional/);
  assert.match(styles, /\.mascot-character\s*\{[^}]*cursor:\s*grab;[^}]*touch-action:\s*none;/s);
  assert.match(styles, /\.mascot-character\.is-dragging\s*\{[^}]*cursor:\s*grabbing;/s);
});

test('getBrowserWindowOptions configures a transparent frameless always-on-top window', () => {
  const preloadPath = path.join(process.cwd(), 'src', 'preload.js');
  const options = getBrowserWindowOptions({
    preloadPath,
    workArea: { x: 10, y: 20, width: 1920, height: 1040 }
  });

  assert.equal(options.x, 10);
  assert.equal(options.y, 20);
  assert.equal(options.width, 1920);
  assert.equal(options.height, 1040);
  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.preload, preloadPath);
});

test('enforceTopMostWindow reapplies topmost behavior after creation and show', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    setAlwaysOnTop(flag, level) {
      calls.push(['always-on-top', flag, level]);
    },
    setVisibleOnAllWorkspaces(flag, options) {
      calls.push(['workspaces', flag, options]);
    },
    moveTop() {
      calls.push(['move-top']);
    }
  };

  enforceTopMostWindow(window);

  assert.deepEqual(calls, [
    ['always-on-top', true, 'screen-saver'],
    ['workspaces', true, { visibleOnFullScreen: true }],
    ['move-top']
  ]);
});

test('createBroadcastState sends mascot state through webContents', () => {
  const sent = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => {
        sent.push({ channel, payload });
      }
    }
  };

  const broadcastState = createBroadcastState(() => window);
  const state = { globalStatus: 'idle', characters: DEFAULT_CHARACTERS };

  broadcastState(state);

  assert.deepEqual(sent, [{ channel: 'mascot:state', payload: state }]);
});

test('createBroadcastState skips destroyed webContents safely', () => {
  const sent = [];
  const broadcastState = createBroadcastState(() => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => true,
      send(channel) {
        sent.push(channel);
      }
    }
  }));

  broadcastState({ globalStatus: 'idle', characters: [] });

  assert.deepEqual(sent, []);
});

test('createMouseIgnoreController lets desktop clicks pass through until mascot interaction starts', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    setIgnoreMouseEvents(ignore, options) {
      calls.push([ignore, options]);
    }
  };
  const controller = createMouseIgnoreController(() => window);

  controller.ignoreDesktopClicks();
  controller.handleInteraction({ interactive: true });
  controller.handleInteraction({ interactive: false });

  assert.deepEqual(calls, [
    [true, { forward: true }],
    [false, undefined],
    [true, { forward: true }]
  ]);
});

test('acquireSingleInstanceLock quits duplicate Electron instances before startup', () => {
  const events = [];
  const logs = [];
  const app = {
    requestSingleInstanceLock() {
      events.push('request-lock');
      return false;
    },
    quit() {
      events.push('quit');
    },
    on(eventName) {
      events.push(`on:${eventName}`);
    }
  };

  const hasLock = acquireSingleInstanceLock(app, () => null, { info: (message) => logs.push(message) });

  assert.equal(hasLock, false);
  assert.deepEqual(events, ['request-lock', 'quit']);
  assert.match(logs[0], /already running/i);
});

test('acquireSingleInstanceLock focuses the existing window on second instance', () => {
  const events = [];
  let secondInstanceHandler = null;
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore() {
      events.push('restore');
    },
    show() {
      events.push('show');
    },
    focus() {
      events.push('focus');
    }
  };
  const app = {
    requestSingleInstanceLock() {
      events.push('request-lock');
      return true;
    },
    on(eventName, handler) {
      events.push(`on:${eventName}`);
      secondInstanceHandler = handler;
    }
  };

  const hasLock = acquireSingleInstanceLock(app, () => window, { info() {} });
  secondInstanceHandler();

  assert.equal(hasLock, true);
  assert.deepEqual(events, ['request-lock', 'on:second-instance', 'restore', 'show', 'focus']);
});

test('createLifecycle registers mouse interaction IPC and starts in desktop-click-through mode', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const fakeWindow = {
    loadFile() {},
    isDestroyed: () => false,
    setIgnoreMouseEvents(ignore, options) {
      events.push({ type: 'ignore-mouse', ignore, options });
    },
    webContents: {
      isDestroyed: () => false,
      send() {}
    }
  };
  const fakeApp = {
    getPath() {
      return 'user-data-path';
    },
    on() {}
  };
  const server = {
    listening: true,
    listen(_port, _host, callback) {
      callback();
    },
    close(callback) {
      this.listening = false;
      callback();
    }
  };

  const lifecycle = createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow() {
      return fakeWindow;
    },
    ipcMain,
    createHttpServer: () => server
  });

  await lifecycle.start();
  await ipcMain.invoke(MOUSE_EVENTS_CHANNEL, { interactive: true });
  await ipcMain.invoke(MOUSE_EVENTS_CHANNEL, { interactive: false });

  assert.equal(events.some((event) => event.type === 'ipc-handle' && event.channel === MOUSE_EVENTS_CHANNEL), true);
  assert.deepEqual(events.filter((event) => event.type === 'ignore-mouse'), [
    { type: 'ignore-mouse', ignore: true, options: { forward: true } },
    { type: 'ignore-mouse', ignore: false, options: undefined },
    { type: 'ignore-mouse', ignore: true, options: { forward: true } }
  ]);
});

test('clampCharacterToWorkArea keeps restored positions visible on startup', () => {
  assert.deepEqual(
    clampCharacterToWorkArea({ id: 'assistant', x: -245, y: 900, width: 180 }, { width: 1920, height: 1080 }),
    { id: 'assistant', x: 0, y: 900, width: 180 }
  );
  assert.deepEqual(
    clampCharacterToWorkArea({ id: 'reviewer', x: 5000, y: 2000, width: 180 }, { width: 1920, height: 1080 }),
    { id: 'reviewer', x: 1740, y: 900, width: 180 }
  );
});

test('createLifecycle builds store, registers IPC current-state handler, and listens on configured host and port', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const server = {
    listening: true,
    listen(port, host, callback) {
      events.push({ type: 'listen', port, host });
      callback();
    },
    close(callback) {
      events.push({ type: 'close' });
      this.listening = false;
      callback();
    }
  };
  const fakeApp = {
    getPath() {
      return 'user-data-path';
    },
    on(eventName, handler) {
      events.push({ type: 'app-on', eventName });
      if (eventName === 'before-quit') {
        this.beforeQuit = handler;
      }
    }
  };
  const fakeWindow = {
    loadFile(filePath) {
      events.push({ type: 'load-file', filePath });
    },
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send(channel, payload) {
        events.push({ type: 'send', channel, payload });
      }
    }
  };

  const lifecycle = createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow(options) {
      events.push({ type: 'window-options', options });
      return fakeWindow;
    },
    ipcMain,
    createHttpServer: ({ store }) => {
      events.push({ type: 'server-created', state: store.getState() });
      return server;
    }
  });

  await lifecycle.start();
  const currentState = await ipcMain.invoke('mascot:get-state');
  await fakeApp.beforeQuit();

  assert.equal(events.some((event) => event.type === 'server-created'), true);
  assert.equal(events.some((event) => event.type === 'listen' && event.host === HOST && event.port === PORT), true);
  assert.equal(events.some((event) => event.type === 'send' && event.channel === 'mascot:state'), true);
  assert.equal(events.some((event) => event.type === 'load-file' && event.filePath === getIndexHtmlPath()), true);
  assert.equal(events.some((event) => event.type === 'ipc-remove' && event.channel === 'mascot:get-state'), true);
  assert.equal(events.some((event) => event.type === 'ipc-handle' && event.channel === 'mascot:get-state'), true);
  assert.equal(events.some((event) => event.type === 'close'), true);
  assert.deepEqual(currentState.characters, []);
});

test('createLifecycle starts with an empty local character list before integrations connect', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const layoutStore = {
    apply(characters) {
      events.push({ type: 'layout-apply', characters });
      return characters.map((character) => ({
        ...character,
        x: character.x + 10,
        y: character.y + 20
      }));
    }
  };
  const server = {
    listening: true,
    listen(_port, _host, callback) {
      callback();
    },
    close(callback) {
      this.listening = false;
      callback();
    }
  };
  const fakeApp = {
    getPath(name) {
      events.push({ type: 'getPath', name });
      return 'user-data-path';
    },
    on(eventName, handler) {
      if (eventName === 'before-quit') {
        this.beforeQuit = handler;
      }
    }
  };
  const fakeWindow = {
    loadFile() {},
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send() {}
    }
  };
  const createStoreCalls = [];

  const lifecycle = createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow() {
      return fakeWindow;
    },
    ipcMain,
    createHttpServer: () => server,
    createLayoutStore: ({ userDataPath, characters }) => {
      createStoreCalls.push({ userDataPath, characters });
      return layoutStore;
    }
  });

  await lifecycle.start();

  assert.deepEqual(createStoreCalls, [{ userDataPath: 'user-data-path', characters: [] }]);
  assert.equal(events.some((event) => event.type === 'layout-apply' && Array.isArray(event.characters) && event.characters.length === 0), true);
});

test('registerFrameHandler returns frames for valid character status only', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const getState = () => ({
    characters: [
      {
        id: 'assistant',
        theme: 'default',
        status: 'working'
      }
    ]
  });
  const discover = ({ assetsRoot, theme, status }) => ({
    status,
    sourceStatus: status,
    frames: [`${assetsRoot}/${theme}/${status}.png`]
  });

  registerFrameHandler(ipcMain, getState, { assetsRoot: 'assets-root', discover });

  const valid = await ipcMain.invoke(GET_FRAMES_CHANNEL, 'assistant', 'working');
  const unknown = await ipcMain.invoke(GET_FRAMES_CHANNEL, 'missing', 'working');
  const invalid = await ipcMain.invoke(GET_FRAMES_CHANNEL, 'assistant', 'not-a-status');

  assert.deepEqual(valid, {
    ok: true,
    status: 'working',
    sourceStatus: 'working',
    frames: ['assets-root/default/working.png']
  });
  assert.deepEqual(unknown, { ok: false, frames: [], sourceStatus: null });
  assert.deepEqual(invalid, { ok: false, frames: [], sourceStatus: null });
  assert.equal(events.some((event) => event.type === 'ipc-handle' && event.channel === GET_FRAMES_CHANNEL), true);
});

test('character management IPC updates themes, characters, and broadcasts state', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const broadcasts = [];
  const store = createStateStore(DEFAULT_CHARACTERS);

  registerCharacterManagementHandlers(ipcMain, store, (state) => broadcasts.push(state), {
    listThemes: () => ['default', 'reviewer']
  });

  assert.deepEqual(await ipcMain.invoke(GET_THEMES_CHANNEL), { ok: true, themes: ['default', 'reviewer'] });

  const update = await ipcMain.invoke(UPDATE_CHARACTER_CHANNEL, 'assistant', {
    name: '菜单文本',
    theme: 'reviewer',
    status: 'busy'
  });

  assert.equal(update.ok, true);
  assert.equal(update.state.characters.find((character) => character.id === 'assistant').name, '菜单文本');
  assert.equal(update.state.characters.find((character) => character.id === 'assistant').theme, 'reviewer');

  const deleted = await ipcMain.invoke(DELETE_CHARACTER_CHANNEL, 'reviewer');

  assert.equal(deleted.ok, true);
  assert.equal(deleted.state.characters.some((character) => character.id === 'reviewer'), false);
  assert.equal(broadcasts.length, 2);
});

test('registerCharacterManagementHandlers persists editable character preferences before broadcasting', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const store = createStateStore([
    createCharacterState({ id: 'assistant', name: '助手', width: 180, x: 10, y: 20 })
  ]);
  const layoutCalls = [];
  const layoutStore = {
    saveCharacterPreferences(characterId, patch) {
      layoutCalls.push([characterId, patch]);
      return { ok: true, layout: { [characterId]: patch } };
    }
  };
  const broadcasts = [];

  registerCharacterManagementHandlers(ipcMain, store, (state) => broadcasts.push(state), {
    layoutStore,
    listThemes: () => ['default', 'reviewer']
  });

  const result = await ipcMain.invoke(UPDATE_CHARACTER_CHANNEL, 'assistant', {
    name: '新的文本',
    theme: 'reviewer',
    width: 220,
    status: 'busy'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(layoutCalls, [
    ['assistant', { name: '新的文本', theme: 'reviewer', width: 220 }]
  ]);
  assert.equal(broadcasts.length, 1);
  assert.equal(store.getState().characters[0].name, '新的文本');
  assert.equal(store.getState().characters[0].width, 220);
  assert.equal(store.getState().characters[0].status, 'busy');
});

test('registerCharacterManagementHandlers persists opencode character preferences through project preferences', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const store = createStateStore([
    createCharacterState({ id: 'opencode-client-a', name: 'App', width: 180, x: 10, y: 20 })
  ]);
  const layoutCalls = [];
  const projectCalls = [];
  const layoutStore = {
    saveCharacterPreferences(characterId, patch) {
      layoutCalls.push([characterId, patch]);
      return { ok: true, layout: { [characterId]: patch } };
    }
  };
  const opencode = {
    updateProjectPreferenceForCharacter(characterId, patch) {
      projectCalls.push([characterId, patch]);
      return { ok: true };
    }
  };

  registerCharacterManagementHandlers(ipcMain, store, () => {}, {
    layoutStore,
    opencode,
    listThemes: () => ['default', 'reviewer']
  });

  const result = await ipcMain.invoke(UPDATE_CHARACTER_CHANNEL, 'opencode-client-a', {
    name: '自定义项目名',
    theme: 'reviewer',
    width: 220,
    status: 'busy'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(projectCalls, [
    ['opencode-client-a', { name: '自定义项目名', theme: 'reviewer', width: 220 }]
  ]);
  assert.deepEqual(layoutCalls, []);
  assert.equal(store.getState().characters[0].name, '自定义项目名');
});

test('registerCharacterManagementHandlers falls back to layout preferences for local characters', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const store = createStateStore([
    createCharacterState({ id: 'assistant', name: '助手', width: 180 })
  ]);
  const layoutCalls = [];
  const projectCalls = [];
  const layoutStore = {
    saveCharacterPreferences(characterId, patch) {
      layoutCalls.push([characterId, patch]);
      return { ok: true, layout: { [characterId]: patch } };
    }
  };
  const opencode = {
    updateProjectPreferenceForCharacter(characterId, patch) {
      projectCalls.push([characterId, patch]);
      return { ok: false, code: 'UNKNOWN_CLIENT' };
    }
  };

  registerCharacterManagementHandlers(ipcMain, store, () => {}, {
    layoutStore,
    opencode,
    listThemes: () => ['default']
  });

  const result = await ipcMain.invoke(UPDATE_CHARACTER_CHANNEL, 'assistant', {
    name: '本地名称',
    width: 200
  });

  assert.equal(result.ok, true);
  assert.deepEqual(projectCalls, [
    ['assistant', { name: '本地名称', width: 200 }]
  ]);
  assert.deepEqual(layoutCalls, [
    ['assistant', { name: '本地名称', width: 200 }]
  ]);
});

test('registerCharacterManagementHandlers does not mutate when preference persistence fails', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const store = createStateStore([
    createCharacterState({ id: 'assistant', name: '助手', width: 180 })
  ]);
  const layoutStore = {
    saveCharacterPreferences() {
      return { ok: false, code: 'WRITE_FAILED', message: 'write failed' };
    }
  };

  registerCharacterManagementHandlers(ipcMain, store, () => {}, {
    layoutStore,
    listThemes: () => ['default']
  });

  const result = await ipcMain.invoke(UPDATE_CHARACTER_CHANNEL, 'assistant', {
    name: '不会保存',
    width: 220
  });

  assert.deepEqual(result, { ok: false, code: 'WRITE_FAILED', message: 'write failed' });
  assert.equal(store.getState().characters[0].name, '助手');
  assert.equal(store.getState().characters[0].width, 180);
});

test('registerPositionHandler saves positions, updates live state, and broadcasts the new snapshot', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const layoutStore = {
    savePosition(characterId, position) {
      events.push({ type: 'savePosition', characterId, position });
      return { ok: true };
    }
  };
  const store = {
    state: {
      globalStatus: 'idle',
      characters: [
        createCharacterState({ id: 'assistant', x: 0, y: 0 }),
        createCharacterState({ id: 'reviewer', x: 50, y: 75 })
      ]
    },
    setCharacterPosition(characterId, position) {
      events.push({ type: 'setCharacterPosition', characterId, position });
      this.state = {
        ...this.state,
        characters: this.state.characters.map((character) => {
          if (character.id !== characterId) {
            return character;
          }

          return {
            ...character,
            x: position.x,
            y: position.y
          };
        })
      };

      return { ok: true };
    },
    getState() {
      return this.state;
    }
  };
  const seenStates = [];

  registerPositionHandler(ipcMain, layoutStore, store, (state) => {
    seenStates.push(state);
  });

  const result = await ipcMain.invoke(UPDATE_POSITION_CHANNEL, 'assistant', { x: 12, y: 34 });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events.filter((event) => event.type === 'savePosition'), [{ type: 'savePosition', characterId: 'assistant', position: { x: 12, y: 34 } }]);
  assert.deepEqual(events.filter((event) => event.type === 'setCharacterPosition'), [{ type: 'setCharacterPosition', characterId: 'assistant', position: { x: 12, y: 34 } }]);
  assert.equal(seenStates.length, 1);
  assert.deepEqual(
    seenStates[0].characters.find((character) => character.id === 'assistant'),
    createCharacterState({ id: 'assistant', x: 12, y: 34 })
  );
});

test('registerPositionHandler does not mutate live state or broadcast when layout persistence fails', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const layoutStore = {
    savePosition(characterId, position) {
      events.push({ type: 'savePosition', characterId, position });
      return { ok: false, code: 'INVALID_POSITION' };
    }
  };
  const store = {
    setCharacterPosition(characterId, position) {
      events.push({ type: 'setCharacterPosition', characterId, position });
      return { ok: true };
    },
    getState() {
      return { globalStatus: 'idle', characters: [createCharacterState()] };
    }
  };
  const seenStates = [];

  registerPositionHandler(ipcMain, layoutStore, store, (state) => {
    seenStates.push(state);
  });

  const result = await ipcMain.invoke(UPDATE_POSITION_CHANNEL, 'assistant', { x: 12, y: 34 });

  assert.deepEqual(result, { ok: false, code: 'INVALID_POSITION' });
  assert.deepEqual(events.filter((event) => event.type === 'setCharacterPosition'), []);
  assert.deepEqual(seenStates, []);
});

test('registerPositionHandler persists opencode character positions through project preferences', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const layoutStore = {
    savePosition(characterId, position) {
      events.push({ type: 'savePosition', characterId, position });
      return { ok: false, code: 'UNKNOWN_CHARACTER' };
    }
  };
  const opencode = {
    updateProjectPreferenceForCharacter(characterId, position) {
      events.push({ type: 'updateProjectPreferenceForCharacter', characterId, position });
      return { ok: true };
    }
  };
  const store = {
    state: {
      globalStatus: 'idle',
      characters: [createCharacterState({ id: 'opencode-client-a', x: 0, y: 0 })]
    },
    setCharacterPosition(characterId, position) {
      events.push({ type: 'setCharacterPosition', characterId, position });
      this.state = {
        ...this.state,
        characters: this.state.characters.map((character) => character.id === characterId ? { ...character, x: position.x, y: position.y } : character)
      };
      return { ok: true };
    },
    getState() {
      return this.state;
    }
  };
  const seenStates = [];

  registerPositionHandler(ipcMain, layoutStore, store, (state) => {
    seenStates.push(state);
  }, { opencode });

  const result = await ipcMain.invoke(UPDATE_POSITION_CHANNEL, 'opencode-client-a', { x: 333, y: 444 });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events.filter((event) => event.type === 'updateProjectPreferenceForCharacter'), [
    { type: 'updateProjectPreferenceForCharacter', characterId: 'opencode-client-a', position: { x: 333, y: 444 } }
  ]);
  assert.deepEqual(events.filter((event) => event.type === 'setCharacterPosition'), [
    { type: 'setCharacterPosition', characterId: 'opencode-client-a', position: { x: 333, y: 444 } }
  ]);
  assert.equal(seenStates.length, 1);
  assert.equal(seenStates[0].characters[0].x, 333);
  assert.equal(seenStates[0].characters[0].y, 444);
});

test('createLifecycle preserves dragged position across later state broadcasts', async () => {
  const events = [];
  const ipcMain = createIpcMainStub(events);
  const serverStateChanges = [];
  const fakeApp = {
    getPath() {
      return 'user-data-path';
    },
    on(eventName, handler) {
      if (eventName === 'before-quit') {
        this.beforeQuit = handler;
      }
    }
  };
  const fakeWindow = {
    once() {},
    on() {},
    show() {},
    loadFile() {},
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send(channel, payload) {
        events.push({ type: 'send', channel, payload });
      }
    }
  };
  const layoutStore = {
    apply(characters) {
      return characters;
    },
    savePosition(characterId, position) {
      events.push({ type: 'savePosition', characterId, position });
      return { ok: true };
    }
  };
  const server = {
    listening: true,
    listen(_port, _host, callback) {
      callback();
    },
    close(callback) {
      this.listening = false;
      callback();
    }
  };

  const lifecycle = createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow() {
      return fakeWindow;
    },
    ipcMain,
    createLayoutStore: () => layoutStore,
    createHttpServer: ({ onStateChange, store }) => {
      serverStateChanges.push({ onStateChange, store });
      return server;
    }
  });

  await lifecycle.start();
  const store = lifecycle.getStore();
  store.addCharacter(createCharacterState({ id: 'assistant' }));
  await ipcMain.invoke(UPDATE_POSITION_CHANNEL, 'assistant', { x: 333, y: 444 });

  const statusResult = store.setCharacterStatus('assistant', 'working');
  assert.deepEqual(statusResult, { ok: true });
  serverStateChanges[0].onStateChange(store.getState());

  const sentStates = events.filter((event) => event.type === 'send' && event.channel === 'mascot:state');
  const latestAssistant = sentStates.at(-1).payload.characters.find((character) => character.id === 'assistant');

  assert.equal(sentStates.length >= 2, true);
  assert.equal(latestAssistant.x, 333);
  assert.equal(latestAssistant.y, 444);
  assert.equal(latestAssistant.status, 'working');
});

test('getAssetsRoot points to the mascot asset directory', () => {
  assert.equal(getAssetsRoot(), path.join(__dirname, '..', 'assets', 'mascot'));
});

test('createLifecycle shutdown is safe when server was never started', async () => {
  const events = [];
  const fakeApp = {
    getPath() {
      return 'user-data-path';
    },
    on(eventName, handler) {
      if (eventName === 'before-quit') {
        this.beforeQuit = handler;
      }
    }
  };

  createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow() {
      events.push('window-created');
      return {
        loadFile() {},
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send() {}
        }
      };
    },
    ipcMain: createIpcMainStub([]),
    createHttpServer: () => ({
      listen() {},
      close() {
        events.push('close-called');
      }
    })
  });

  await assert.doesNotReject(async () => {
    await fakeApp.beforeQuit();
  });
  assert.deepEqual(events, []);
});

test('createLifecycle cleans up window and server when listenServer fails after startup begins', async () => {
  const events = [];
  const fakeApp = {
    getPath() {
      return 'user-data-path';
    },
    on() {}
  };
  const fakeWindow = {
    once() {},
    on(_eventName, handler) {
      this.closedHandler = handler;
    },
    loadFile() {
      events.push('loadFile');
      return Promise.resolve();
    },
    close() {
      events.push('window-close');
      this.closedHandler?.();
    },
    destroy() {
      events.push('window-destroy');
    },
    isDestroyed() {
      return false;
    },
    webContents: {
      isDestroyed: () => false,
      send() {}
    }
  };
  const server = {
    listening: true,
    once(eventName, handler) {
      if (eventName === 'error') {
        this.errorHandler = handler;
      }
    },
    removeListener() {},
    listen() {
      this.errorHandler?.(new Error('listen failed'));
    },
    close(callback) {
      events.push('server-close');
      this.listening = false;
      callback();
    }
  };

  const lifecycle = createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow() {
      return fakeWindow;
    },
    ipcMain: createIpcMainStub([]),
    createHttpServer: () => server
  });

  await assert.rejects(() => lifecycle.start(), /listen failed/);
  assert.deepEqual(events, ['loadFile', 'window-close', 'window-destroy', 'server-close']);
  assert.equal(lifecycle.getWindow(), null);
  assert.equal(lifecycle.getServer(), null);
});

test('createLifecycle cleans up window and server when loadFile rejects after server starts', async () => {
  const events = [];
  const fakeApp = {
    getPath() {
      return 'user-data-path';
    },
    on() {}
  };
  const fakeWindow = {
    once() {},
    on(_eventName, handler) {
      this.closedHandler = handler;
    },
    loadFile() {
      events.push('loadFile');
      return Promise.reject(new Error('load failed'));
    },
    close() {
      events.push('window-close');
      this.closedHandler?.();
    },
    destroy() {
      events.push('window-destroy');
    },
    isDestroyed() {
      return false;
    },
    webContents: {
      isDestroyed: () => false,
      send() {}
    }
  };
  const server = {
    listening: true,
    once() {},
    removeListener() {},
    listen(_port, _host, callback) {
      events.push('listen');
      callback();
    },
    close(callback) {
      events.push('server-close');
      this.listening = false;
      callback();
    }
  };

  const lifecycle = createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow() {
      return fakeWindow;
    },
    ipcMain: createIpcMainStub([]),
    createHttpServer: () => server
  });

  await assert.rejects(() => lifecycle.start(), /load failed/);
  assert.deepEqual(events, ['loadFile', 'listen', 'window-close', 'window-destroy', 'server-close']);
  assert.equal(lifecycle.getWindow(), null);
  assert.equal(lifecycle.getServer(), null);
});

test('createLifecycle shutdown is idempotent when called twice', async () => {
  const events = [];
  const fakeApp = {
    getPath() {
      return 'user-data-path';
    },
    on(eventName, handler) {
      if (eventName === 'before-quit') {
        this.beforeQuit = handler;
      }
    }
  };
  const server = {
    listening: true,
    listen(_port, _host, callback) {
      callback();
    },
    close(callback) {
      events.push('close');
      this.listening = false;
      callback();
    }
  };

  const lifecycle = createLifecycle({
    app: fakeApp,
    BrowserWindow: function BrowserWindow() {
      return {
        loadFile() {},
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send() {}
        }
      };
    },
    ipcMain: createIpcMainStub([]),
    createHttpServer: () => server
  });

  await lifecycle.start();
  await fakeApp.beforeQuit();
  await fakeApp.beforeQuit();

  assert.deepEqual(events, ['close']);
  assert.equal(lifecycle.getServer(), null);
});

test('buildCharacterAssetPath points renderer assets at mascot webp files', () => {
  assert.equal(
    buildCharacterAssetPath({ theme: 'default', status: 'working' }),
    '../assets/mascot/default/working.webp'
  );
});

test('startFramePlayer loops through multiple frames with fake timers', () => {
  const timers = createFakeTimers();
  const image = createElementStub('img');
  const stop = startFramePlayer({
    imageNode: image,
    frames: ['frame-1.webp', 'frame-2.webp', 'frame-3.webp'],
    timers,
    fps: 8
  });

  assert.equal(image.src, 'frame-1.webp');
  assert.equal(timers.activeCount(), 1);

  timers.tick(125);
  assert.equal(image.src, 'frame-2.webp');

  timers.tick(125);
  assert.equal(image.src, 'frame-3.webp');

  timers.tick(125);
  assert.equal(image.src, 'frame-1.webp');

  stop();
  assert.equal(timers.activeCount(), 0);
});

test('stopFramePlayer clears the active timer once', () => {
  const timers = createFakeTimers();
  const image = createElementStub('img');
  const stop = startFramePlayer({
    imageNode: image,
    frames: ['frame-1.webp', 'frame-2.webp'],
    timers,
    fps: 8
  });

  assert.equal(timers.activeCount(), 1);

  stopFramePlayer(stop);
  stopFramePlayer(stop);

  assert.equal(timers.activeCount(), 0);
});

test('renderFrameFallback replaces the visual with the CSS fallback node', () => {
  const section = createElementStub('section');
  const visual = createElementStub('div');
  section.visualNode = visual;

  renderFrameFallback(section, createCharacterState({ name: '助手' }));

  assert.equal(visual.children.length, 1);
  assert.equal(visual.children[0].className, 'mascot-character__fallback');
  assert.equal(visual.children[0].textContent, '助');
});

test('initRenderer gets initial state and subscribes before initial frame loading completes', async () => {
  const stage = createStageStub();
  const calls = [];
  const windowRef = {
    document: {
      getElementById(id) {
        calls.push(['get-element', id]);
        return stage;
      }
    },
      mascotApi: {
        async getInitialState() {
          calls.push(['getInitialState']);
          return {
            characters: [
            createCharacterState({
              id: 'assistant',
              x: 12,
              y: 16,
              width: 180,
                zIndex: 3,
                status: 'working'
              })
            ]
          };
        },
        async getFrames(characterId, status) {
          calls.push(['getFrames', characterId, status]);
          return {
            ok: true,
            status,
            sourceStatus: status,
            frames: ['assistant-working-1.webp']
          };
        },
        onStateChange(callback) {
          calls.push(['onStateChange']);
          this.callback = callback;
          return () => {
            calls.push(['unsubscribe']);
        };
      }
    }
  };
  const consoleRef = { error() { throw new Error('should not log'); } };

  await initRenderer(windowRef, consoleRef);

  assert.deepEqual(calls.slice(1, 4), [
    ['getInitialState'],
    ['onStateChange'],
    ['getFrames', 'assistant', 'working']
  ]);
  assert.equal(stage.children.length, 1);
  assert.equal(stage.children[0].dataset.characterId, 'assistant');
});

test('initRenderer logs a warning, renders fallback, and still subscribes when initial getFrames rejects', async () => {
  const stage = createStageStub();
  const warnings = [];
  const calls = [];
  const windowRef = {
    document: {
      getElementById() {
        return stage;
      }
    },
    mascotApi: {
      async getInitialState() {
        calls.push(['getInitialState']);
        return {
          characters: [createCharacterState({ id: 'assistant', status: 'working' })]
        };
      },
      async getFrames(characterId, status) {
        calls.push(['getFrames', characterId, status]);

        if (status === 'working') {
          throw new Error('frames unavailable');
        }

        return {
          ok: true,
          status,
          sourceStatus: status,
          frames: ['assistant-done-1.webp']
        };
      },
      onStateChange(callback) {
        calls.push(['onStateChange']);
        this.callback = callback;
      }
    }
  };

  await initRenderer(windowRef, {
    error(message) {
      throw new Error(`unexpected error log: ${message}`);
    },
    warn(message, error) {
      warnings.push([message, error?.message]);
    }
  });

  assert.equal(stage.children.length, 1);
  assert.equal(stage.children[0].children[0].children[0].className, 'mascot-character__fallback');
  assert.deepEqual(warnings, [['Mascot renderer failed to load frames for assistant:', 'frames unavailable']]);
  assert.deepEqual(calls, [
    ['getInitialState'],
    ['onStateChange'],
    ['getFrames', 'assistant', 'working']
  ]);

  await assert.doesNotReject(async () => {
    await windowRef.mascotApi.callback({
      characters: [createCharacterState({ id: 'assistant', status: 'done' })]
    });
  });

  assert.equal(stage.children[0].children[0].children[0].src, 'assistant-done-1.webp');
});

test('initRenderer clears stage and logs error when mascotApi is missing', async () => {
  const stage = createStageStub();
  stage.appendChild(createElementStub('section'));
  const errors = [];

  await initRenderer(
    {
      document: {
        getElementById() {
          return stage;
        }
      }
    },
    {
      error(message) {
        errors.push(message);
      }
    }
  );

  assert.equal(stage.children.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /window\.mascotApi/);
});

test('renderState updates existing nodes instead of replacing the whole stage', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp'],
    'reviewer:idle': ['reviewer-idle-1.webp'],
    'assistant:done': ['assistant-done-1.webp']
  });
  const firstState = {
    characters: [
      createCharacterState({
        id: 'assistant',
        x: 10,
        y: 20,
        width: 180,
        zIndex: 2,
        status: 'working'
      }),
      createCharacterState({
        id: 'reviewer',
        name: '审查员',
        theme: 'reviewer',
        x: 240,
        y: 0,
        width: 180,
        zIndex: 1,
        status: 'idle'
      })
    ]
  };
  const secondState = {
    characters: [
      createCharacterState({
        id: 'assistant',
        x: 40,
        y: 50,
        width: 200,
        zIndex: 5,
        status: 'done'
      })
    ]
  };

  await renderState(stage, firstState, { mascotApi });
  const firstAssistantNode = stage.children[0];

  await renderState(stage, secondState, { mascotApi });

  assert.equal(stage.children.length, 1);
  assert.equal(stage.children[0], firstAssistantNode);
  assert.equal(stage.children[0].style.left, '40px');
  assert.equal(stage.children[0].style.top, '50px');
  assert.equal(stage.children[0].style.width, '200px');
  assert.equal(stage.children[0].children[0].style.width, '200px');
  assert.equal(stage.children[0].children[1].style.width, '200px');
  assert.equal(stage.children[0].style.zIndex, '5');
  assert.equal(stage.children[0].children[0].children[0].src, 'assistant-done-1.webp');
});

test('renderState reorders visible characters with HTMLCollection-like children', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp'],
    'reviewer:idle': ['reviewer-idle-1.webp'],
    'reviewer:done': ['reviewer-done-1.webp'],
    'assistant:done': ['assistant-done-1.webp']
  });
  const firstState = {
    characters: [
      createCharacterState({
        id: 'assistant',
        x: 10,
        y: 20,
        width: 180,
        zIndex: 2,
        status: 'working'
      }),
      createCharacterState({
        id: 'reviewer',
        name: '审查员',
        theme: 'reviewer',
        x: 240,
        y: 0,
        width: 180,
        zIndex: 1,
        status: 'idle'
      })
    ]
  };
  const reorderedState = {
    characters: [
      createCharacterState({
        id: 'reviewer',
        name: '审查员',
        theme: 'reviewer',
        x: 240,
        y: 0,
        width: 180,
        zIndex: 4,
        status: 'done'
      }),
      createCharacterState({
        id: 'assistant',
        x: 40,
        y: 50,
        width: 200,
        zIndex: 5,
        status: 'done'
      })
    ]
  };

  await renderState(stage, firstState, { mascotApi });

  await assert.doesNotReject(async () => {
    await renderState(stage, reorderedState, { mascotApi });
  });
  assert.equal(stage.children.length, 2);
  assert.equal(stage.children[0].dataset.characterId, 'reviewer');
  assert.equal(stage.children[1].dataset.characterId, 'assistant');
});

test('renderState normalizes invalid numeric values before applying styles', async () => {
  const stage = createStageStub();

  await renderState(stage, {
    characters: [
      createCharacterState({
        id: 'assistant',
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        width: -10,
        zIndex: 'oops'
      })
    ]
  }, {
    mascotApi: createMascotApiStub({
      'assistant:idle': ['assistant-idle-1.webp']
    })
  });

  assert.equal(stage.children[0].style.left, '0px');
  assert.equal(stage.children[0].style.top, '0px');
  assert.equal(stage.children[0].style.width, '160px');
  assert.equal(stage.children[0].children[0].style.width, '160px');
  assert.equal(stage.children[0].children[1].style.width, '160px');
  assert.equal(stage.children[0].style.zIndex, '1');
});

test('renderState clamps small positive widths to the expanded minimum width', async () => {
  const stage = createStageStub();

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', width: 12 })]
  }, {
    mascotApi: createMascotApiStub({
      'assistant:idle': ['assistant-idle-1.webp']
    })
  });

  assert.equal(stage.children[0].style.width, '48px');
  assert.equal(stage.children[0].children[0].style.width, '48px');
  assert.equal(stage.children[0].children[1].style.width, '48px');
});

test('renderState renders one-frame states statically without creating a timer', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();

  await renderState(stage, {
    characters: [
      createCharacterState({
        id: 'assistant',
        status: 'working'
      })
    ]
  }, {
    mascotApi: createMascotApiStub({
      'assistant:working': ['assistant-working-1.webp']
    }),
    timers
  });

  assert.equal(stage.children[0].children[0].children[0].src, 'assistant-working-1.webp');
  assert.equal(timers.activeCount(), 0);
});

test('renderState loops multiple frames with one timer for a visible animated character', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();

  await renderState(stage, {
    characters: [
      createCharacterState({
        id: 'assistant',
        status: 'working',
        theme: 'default'
      })
    ]
  }, {
    mascotApi: createMascotApiStub({
      'assistant:working': ['assistant-working-1.webp', 'assistant-working-2.webp']
    }),
    timers
  });

  const image = stage.children[0].children[0].children[0];

  assert.equal(image.src, 'assistant-working-1.webp');
  assert.equal(timers.activeCount(), 1);

  timers.tick(125);
  assert.equal(image.src, 'assistant-working-2.webp');

  timers.tick(125);
  assert.equal(image.src, 'assistant-working-1.webp');
  assert.equal(timers.activeCount(), 1);
});

test('renderState lets pointer dragging move only the active character and persists on pointerup', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp'],
    'reviewer:idle': ['reviewer-idle-1.webp']
  });

  await renderState(stage, {
    characters: [
      createCharacterState({ id: 'assistant', x: 10, y: 20, status: 'working' }),
      createCharacterState({ id: 'reviewer', name: '审查员', theme: 'reviewer', x: 200, y: 40, status: 'idle' })
    ]
  }, { mascotApi });

  const assistant = stage.children[0];
  const reviewer = stage.children[1];

  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 7,
    button: 0,
    clientX: 100,
    clientY: 150
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 7,
    clientX: 130,
    clientY: 190
  });

  assert.equal(assistant.style.left, '40px');
  assert.equal(assistant.style.top, '60px');
  assert.equal(reviewer.style.left, '200px');
  assert.equal(reviewer.style.top, '40px');
  assert.equal(assistant.classList.contains('is-dragging'), true);
  assert.deepEqual(assistant.pointerCaptureCalls, [7]);

  assistant.dispatchEvent({
    type: 'pointerup',
    pointerId: 7,
    clientX: 130,
    clientY: 190
  });

  assert.equal(assistant.classList.contains('is-dragging'), false);
  assert.deepEqual(assistant.releasedPointerCaptureCalls, [7]);
  assert.deepEqual(mascotApi.updateCalls, [
    ['assistant', { x: 40, y: 60 }]
  ]);
});

test('renderState opens direct control menu and updates character from menu controls', async () => {
  const stage = createStageStub();
  const updates = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default', 'reviewer'] };
    },
    async updateCharacter(characterId, patch) {
      updates.push([characterId, patch]);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle', x: 120, integrationDetail: '接入详情：测试目录' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  const menu = assistant.children[2];
  assert.equal(menu.classList.contains('mascot-character__menu'), true);
  assert.equal(menu.style.left, '308px');
  assert.equal(menu.style.top, '0px');

  assert.equal(menu.children[1].textContent, '接入详情：测试目录');
  const nameInput = menu.children[2].children[0];
  const themeSelect = menu.children[3].children[0];
  const statusSelect = menu.children[4].children[0];
  const showStatusSelect = menu.children[5].children[0];
  const sizeInput = menu.children[6].children[0];

  assert.equal(sizeInput.type, 'range');
  assert.equal(sizeInput.min, '48');
  assert.equal(sizeInput.max, '960');
  assert.equal(sizeInput.step, '8');

  nameInput.value = '新文本';
  themeSelect.value = 'reviewer';
  statusSelect.value = 'busy';
  showStatusSelect.value = 'false';
  sizeInput.value = '224';
  sizeInput.dispatchEvent({ type: 'input' });
  await flushPromises();

  assert.deepEqual(updates, [
    ['assistant', { name: '新文本', theme: 'reviewer', status: 'busy', showStatus: false, width: 224 }]
  ]);
  assert.equal(assistant.style.width, '224px');
  assert.equal(assistant.children[0].style.width, '224px');
  assert.equal(assistant.children[1].style.width, '224px');
  assert.equal(assistant.style.left, '120px');
  assert.equal(assistant.classList.contains('has-menu'), true);
});

test('renderState lets resize preview overflow and clamps back on slider release', async () => {
  const stage = createStageStub({ width: 300, height: 240 });
  const updates = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    },
    async updateCharacter(characterId, patch) {
      updates.push([characterId, patch]);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 120, y: 20, width: 180 })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  const menu = assistant.children[2];
  const sizeInput = menu.children[6].children[0];
  sizeInput.value = '960';
  sizeInput.dispatchEvent({ type: 'input' });
  await flushPromises();

  assert.equal(assistant.style.left, '120px');
  assert.equal(assistant.style.width, '960px');

  sizeInput.dispatchEvent({ type: 'change' });
  await flushPromises();

  assert.equal(assistant.style.left, '0px');
  assert.equal(assistant.style.width, '960px');
  assert.deepEqual(updates, [
    ['assistant', { name: '助手', theme: 'default', status: 'idle', showStatus: true, width: 960 }],
    ['assistant', { name: '助手', theme: 'default', status: 'idle', showStatus: true, width: 960 }]
  ]);
  assert.deepEqual(mascotApi.updateCalls, [
    ['assistant', { x: 0, y: 0 }]
  ]);
});

test('renderState closes direct control menu after clicking stage background', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  assert.equal(assistant.classList.contains('has-menu'), true);

  stage.dispatchEvent({ type: 'pointerdown', button: 0 });

  assert.equal(assistant.classList.contains('has-menu'), false);
  assert.equal(assistant.children.length, 2);
});

test('renderState closes direct control menu after clicking character area outside menu', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  assistant.dispatchEvent({ type: 'pointerdown', pointerId: 19, button: 0, target: assistant.children[0] });

  assert.equal(assistant.classList.contains('has-menu'), false);
  assert.equal(assistant.classList.contains('is-dragging'), false);
  assert.equal(assistant.children.length, 2);
});

test('renderState auto-saves direct control menu changes without closing it', async () => {
  const stage = createStageStub();
  const updates = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default', 'reviewer'] };
    },
    async updateCharacter(characterId, patch) {
      updates.push([characterId, patch]);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  const menu = assistant.children[2];
  const nameInput = menu.children[2].children[0];
  const themeSelect = menu.children[3].children[0];
  const statusSelect = menu.children[4].children[0];
  assert.equal(menu.children.length, 8);
  nameInput.value = '保存后的文本';
  themeSelect.value = 'default';
  statusSelect.value = 'idle';

  nameInput.dispatchEvent({ type: 'blur' });
  await flushPromises();

  assert.deepEqual(updates, [
    ['assistant', { name: '保存后的文本', theme: 'default', status: 'idle', showStatus: true, width: 180 }]
  ]);
  assert.equal(assistant.children[1].children[0].textContent, '保存后的文本');
  assert.equal(assistant.classList.contains('has-menu'), true);
  assert.equal(assistant.children.length, 3);
});

test('renderState opens menu with default theme when current theme is missing', async () => {
  const stage = createStageStub();
  const updates = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    },
    async updateCharacter(characterId, patch) {
      updates.push([characterId, patch]);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'reviewer', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  const menu = assistant.children[2];
  const themeSelect = menu.children[3].children[0];
  const nameInput = menu.children[2].children[0];

  assert.equal(menu.classList.contains('mascot-character__menu'), true);
  assert.equal(themeSelect.value, 'default');

  nameInput.value = '恢复默认形象';
  nameInput.dispatchEvent({ type: 'blur' });
  await flushPromises();

  assert.deepEqual(updates, [
    ['assistant', { name: '恢复默认形象', theme: 'default', status: 'idle', showStatus: true, width: 180 }]
  ]);
});

test('renderState previews select changes immediately while keeping the direct menu open', async () => {
  const stage = createStageStub();
  const updates = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp'],
    'assistant:busy': ['assistant-busy-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default', 'reviewer'] };
    },
    async updateCharacter(characterId, patch) {
      updates.push([characterId, patch]);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  const menu = assistant.children[2];
  const themeSelect = menu.children[3].children[0];
  const statusSelect = menu.children[4].children[0];
  const showStatusSelect = menu.children[5].children[0];

  themeSelect.value = 'reviewer';
  themeSelect.dispatchEvent({ type: 'change' });
  statusSelect.value = 'busy';
  statusSelect.dispatchEvent({ type: 'change' });
  showStatusSelect.value = 'false';
  showStatusSelect.dispatchEvent({ type: 'change' });
  await flushPromises();

  assert.equal(assistant.currentCharacter.theme, 'reviewer');
  assert.equal(assistant.currentCharacter.status, 'busy');
  assert.equal(assistant.children[1].children[1].hidden, true);
  assert.equal(assistant.classList.contains('has-menu'), true);
  assert.deepEqual(updates, [
    ['assistant', { name: '助手', theme: 'reviewer', status: 'idle', showStatus: true, width: 180 }],
    ['assistant', { name: '助手', theme: 'reviewer', status: 'busy', showStatus: true, width: 180 }],
    ['assistant', { name: '助手', theme: 'reviewer', status: 'busy', showStatus: false, width: 180 }]
  ]);
});

test('renderState keeps mouse interaction enabled while direct menu is open after pointer leaves character', async () => {
  const stage = createStageStub();
  const interactions = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    },
    async setMouseInteraction(interactive) {
      interactions.push(interactive);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();
  assistant.dispatchEvent({ type: 'pointerleave' });
  await flushPromises();

  assert.deepEqual(interactions, [true]);
});

test('renderState does not start dragging when pointerdown originates from direct menu controls', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();

  const menu = assistant.children[2];
  const nameInput = menu.children[2].children[0];
  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 31,
    button: 0,
    clientX: 210,
    clientY: 60,
    target: nameInput
  });

  assert.equal(assistant.classList.contains('is-dragging'), false);
  assert.deepEqual(assistant.pointerCaptureCalls, []);
});

test('renderState keeps mouse interaction enabled after drag ends while pointer is still over the character', async () => {
  const stage = createStageStub();
  const interactions = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async setMouseInteraction(interactive) {
      interactions.push(interactive);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle', x: 10, y: 10 })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'pointerenter' });
  assistant.dispatchEvent({ type: 'pointerdown', pointerId: 41, button: 0, clientX: 50, clientY: 50 });
  assistant.dispatchEvent({ type: 'pointermove', pointerId: 41, clientX: 70, clientY: 70 });
  assistant.dispatchEvent({ type: 'pointerup', pointerId: 41, clientX: 70, clientY: 70 });
  await flushPromises();

  assert.deepEqual(interactions, [true, true]);
});

test('renderState releases fullscreen mouse capture when pointer moves over transparent stage background', async () => {
  const stage = createStageStub();
  const interactions = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async setMouseInteraction(interactive) {
      interactions.push(interactive);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'pointerenter' });
  assistant.dispatchEvent({ type: 'pointerleave' });
  stage.dispatchEvent({ type: 'pointermove', target: stage });
  await flushPromises();

  assert.deepEqual(interactions, [true, false]);
});

test('renderState keeps direct menu open while pointer crosses transparent gap toward the menu', async () => {
  const stage = createStageStub();
  const interactions = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    },
    async setMouseInteraction(interactive) {
      interactions.push(interactive);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();
  assistant.dispatchEvent({ type: 'pointerleave' });
  stage.dispatchEvent({ type: 'pointermove', target: stage });
  await flushPromises();

  assert.equal(Boolean(assistant.menuNode), true);
  assert.deepEqual(interactions, [true]);
});

test('renderState releases menu-held mouse capture when transparent stage background is clicked', async () => {
  const stage = createStageStub();
  const interactions = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    },
    async setMouseInteraction(interactive) {
      interactions.push(interactive);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
  await flushPromises();
  assistant.dispatchEvent({ type: 'pointerleave' });
  stage.dispatchEvent({ type: 'pointerdown', target: stage });
  await flushPromises();

  assert.equal(Boolean(assistant.menuNode), false);
  assert.deepEqual(interactions, [true, false]);
});

test('renderState deletes a character from the direct control menu', async () => {
  const stage = createStageStub();
  const deletes = [];
  const mascotApi = createMascotApiStub({
    'assistant:idle': ['assistant-idle-1.webp']
  }, {
    async getThemes() {
      return { ok: true, themes: ['default'] };
    },
    async deleteCharacter(characterId) {
      deletes.push(characterId);
      return { ok: true };
    }
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', name: '助手', theme: 'default', status: 'idle' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.dispatchEvent({ type: 'dblclick', clientX: 50, clientY: 60 });
  await flushPromises();

  const menu = assistant.children[2];
  menu.children[7].dispatchEvent({ type: 'click' });
  await flushPromises();

  assert.deepEqual(deletes, ['assistant']);
});

test('renderState keeps dragged characters inside the visible stage bounds', async () => {
  const stage = createStageStub({ width: 300, height: 240 });
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 10, y: 20, width: 120, status: 'working' })]
  }, { mascotApi });

  const assistant = stage.children[0];
  assistant.offsetWidth = 120;
  assistant.offsetHeight = 150;

  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 17,
    button: 0,
    clientX: 100,
    clientY: 100
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 17,
    clientX: 1000,
    clientY: 1000
  });

  assert.equal(assistant.style.left, '180px');
  assert.equal(assistant.style.top, '90px');

  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 17,
    clientX: -1000,
    clientY: -1000
  });

  assert.equal(assistant.style.left, '0px');
  assert.equal(assistant.style.top, '0px');

  assistant.dispatchEvent({
    type: 'pointerup',
    pointerId: 17,
    clientX: -1000,
    clientY: -1000
  });

  assert.deepEqual(mascotApi.updateCalls, [
    ['assistant', { x: 0, y: 0 }]
  ]);
});

test('renderState persists dragged position exactly once when pointerup fires twice for the same pointer', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 12, y: 18, status: 'working' })]
  }, { mascotApi });

  const assistant = stage.children[0];

  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 11,
    button: 0,
    clientX: 50,
    clientY: 80
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 11,
    clientX: 90,
    clientY: 140
  });
  assistant.dispatchEvent({
    type: 'pointerup',
    pointerId: 11,
    clientX: 90,
    clientY: 140
  });
  assistant.dispatchEvent({
    type: 'pointerup',
    pointerId: 11,
    clientX: 90,
    clientY: 140
  });

  assert.deepEqual(mascotApi.updateCalls, [
    ['assistant', { x: 52, y: 78 }]
  ]);
  assert.deepEqual(assistant.releasedPointerCaptureCalls, [11]);
});

test('renderState does not duplicate drag listeners after rerendering the same visible character', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp'],
    'assistant:done': ['assistant-done-1.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 15, y: 25, status: 'working' })]
  }, { mascotApi });
  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 15, y: 25, status: 'done' })]
  }, { mascotApi });
  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 15, y: 25, status: 'working' })]
  }, { mascotApi });

  const assistant = stage.children[0];

  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 12,
    button: 0,
    clientX: 40,
    clientY: 70
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 12,
    clientX: 65,
    clientY: 105
  });
  assistant.dispatchEvent({
    type: 'pointerup',
    pointerId: 12,
    clientX: 65,
    clientY: 105
  });

  assert.equal(assistant.style.left, '40px');
  assert.equal(assistant.style.top, '60px');
  assert.deepEqual(assistant.pointerCaptureCalls, [12]);
  assert.deepEqual(assistant.releasedPointerCaptureCalls, [12]);
  assert.deepEqual(mascotApi.updateCalls, [
    ['assistant', { x: 40, y: 60 }]
  ]);
});

test('renderState warns without throwing when dragged position persistence rejects', async () => {
  const stage = createStageStub();
  const persistenceError = new Error('disk unavailable');
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp']
  }, {
    updateCharacterPosition() {
      return Promise.reject(persistenceError);
    }
  });
  const warnings = [];
  const consoleRef = {
    warn(...args) {
      warnings.push(args);
    }
  };

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 0, y: 0, status: 'working' })]
  }, { mascotApi, console: consoleRef });

  const assistant = stage.children[0];
  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 13,
    button: 0,
    clientX: 10,
    clientY: 20
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 13,
    clientX: 30,
    clientY: 50
  });

  assert.doesNotThrow(() => {
    assistant.dispatchEvent({
      type: 'pointerup',
      pointerId: 13,
      clientX: 30,
      clientY: 50
    });
  });

  await flushPromises();

  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /failed to persist dragged position for assistant/i);
  assert.equal(warnings[0][1], persistenceError);
});

test('renderState ignores non-primary mouse pointerdown for dragging', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 10, y: 20, status: 'working' })]
  }, { mascotApi });

  const assistant = stage.children[0];

  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 9,
    button: 2,
    clientX: 100,
    clientY: 150
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 9,
    clientX: 130,
    clientY: 190
  });
  assistant.dispatchEvent({
    type: 'pointerup',
    pointerId: 9,
    clientX: 130,
    clientY: 190
  });

  assert.equal(assistant.style.left, '10px');
  assert.equal(assistant.style.top, '20px');
  assert.deepEqual(assistant.pointerCaptureCalls, []);
  assert.deepEqual(mascotApi.updateCalls, []);
});

test('renderState does not persist position on pointercancel', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 5, y: 8, status: 'working' })]
  }, { mascotApi });

  const assistant = stage.children[0];

  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 3,
    button: 0,
    clientX: 20,
    clientY: 30
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 3,
    clientX: 70,
    clientY: 90
  });
  assistant.dispatchEvent({
    type: 'pointercancel',
    pointerId: 3,
    clientX: 70,
    clientY: 90
  });

  assert.equal(assistant.style.left, '55px');
  assert.equal(assistant.style.top, '68px');
  assert.equal(assistant.classList.contains('is-dragging'), false);
  assert.deepEqual(assistant.releasedPointerCaptureCalls, [3]);
  assert.deepEqual(mascotApi.updateCalls, []);
});

test('renderState keeps frame timer running during drag without resetting it', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp', 'assistant-working-2.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', x: 0, y: 0, status: 'working' })]
  }, { mascotApi, timers });

  const assistant = stage.children[0];
  const image = assistant.children[0].children[0];
  const timerId = timers.lastScheduledId();

  assistant.dispatchEvent({
    type: 'pointerdown',
    pointerId: 5,
    button: 0,
    clientX: 10,
    clientY: 20
  });
  assistant.dispatchEvent({
    type: 'pointermove',
    pointerId: 5,
    clientX: 50,
    clientY: 80
  });

  assert.equal(timers.activeCount(), 1);
  assert.equal(timers.lastScheduledId(), timerId);
  assert.equal(image.src, 'assistant-working-1.webp');

  timers.tick(125);
  assert.equal(image.src, 'assistant-working-2.webp');
  assert.equal(timers.lastScheduledId(), timerId);

  assistant.dispatchEvent({
    type: 'pointerup',
    pointerId: 5,
    clientX: 50,
    clientY: 80
  });

  assert.equal(timers.activeCount(), 1);
  assert.equal(timers.lastScheduledId(), timerId);
});

test('renderState resets to the first frame and replaces the timer when status changes', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp', 'assistant-working-2.webp'],
    'assistant:done': ['assistant-done-1.webp', 'assistant-done-2.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working' })]
  }, { mascotApi, timers });

  let image = stage.children[0].children[0].children[0];
  timers.tick(125);
  assert.equal(image.src, 'assistant-working-2.webp');
  const firstTimerId = timers.lastScheduledId();

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'done' })]
  }, { mascotApi, timers });

  image = stage.children[0].children[0].children[0];
  assert.equal(image.src, 'assistant-done-1.webp');
  assert.equal(timers.activeCount(), 1);
  assert.notEqual(timers.lastScheduledId(), firstTimerId);

  timers.tick(125);
  assert.equal(image.src, 'assistant-done-2.webp');
});

test('clearStage stops active frame timers for animated characters', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();

  await renderState(stage, {
    characters: [
      createCharacterState({
        id: 'assistant',
        status: 'working'
      })
    ]
  }, {
    mascotApi: createMascotApiStub({
      'assistant:working': ['assistant-working-1.webp', 'assistant-working-2.webp']
    }),
    timers
  });

  assert.equal(timers.activeCount(), 1);

  clearStage(stage);

  assert.equal(stage.children.length, 0);
  assert.equal(timers.activeCount(), 0);
});

test('renderState ignores late getFrames results from an older status render', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();
  const workingFrames = createDeferred();
  const doneFrames = createDeferred();
  const calls = [];
  const mascotApi = {
    async getFrames(characterId, status) {
      calls.push([characterId, status]);

      if (status === 'working') {
        return workingFrames.promise;
      }

      if (status === 'done') {
        return doneFrames.promise;
      }

      return { ok: true, status, sourceStatus: status, frames: [] };
    }
  };

  const renderWorking = renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working' })]
  }, { mascotApi, timers });

  const renderDone = renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'done' })]
  }, { mascotApi, timers });

  doneFrames.resolve({
    ok: true,
    status: 'done',
    sourceStatus: 'done',
    frames: ['assistant-done-1.webp', 'assistant-done-2.webp']
  });

  await renderDone;

  let image = stage.children[0].children[0].children[0];
  assert.equal(image.src, 'assistant-done-1.webp');
  assert.equal(timers.activeCount(), 1);

  workingFrames.resolve({
    ok: true,
    status: 'working',
    sourceStatus: 'working',
    frames: ['assistant-working-1.webp', 'assistant-working-2.webp']
  });

  await renderWorking;

  image = stage.children[0].children[0].children[0];
  assert.equal(image.src, 'assistant-done-1.webp');

  timers.tick(125);
  assert.equal(image.src, 'assistant-done-2.webp');
  assert.equal(timers.activeCount(), 1);
  assert.deepEqual(calls, [
    ['assistant', 'working'],
    ['assistant', 'done']
  ]);
});

test('renderState stops frame timers when characters are hidden or removed', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp', 'assistant-working-2.webp']
  });

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working', visible: true })]
  }, { mascotApi, timers });

  assert.equal(timers.activeCount(), 1);

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working', visible: false })]
  }, { mascotApi, timers });

  assert.equal(stage.children.length, 0);
  assert.equal(timers.activeCount(), 0);

  await renderState(stage, { characters: [] }, { mascotApi, timers });
  assert.equal(stage.children.length, 0);
  assert.equal(timers.activeCount(), 0);
});

test('renderState invalidates pending async renders when a character is hidden before getFrames resolves', async () => {
  const stage = createStageStub();
  const timers = createFakeTimers();
  const workingFrames = createDeferred();
  const mascotApi = {
    async getFrames() {
      return workingFrames.promise;
    }
  };

  const renderPromise = renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working', visible: true })]
  }, { mascotApi, timers });

  assert.equal(stage.children.length, 1);

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working', visible: false })]
  }, { mascotApi, timers });

  assert.equal(stage.children.length, 0);

  workingFrames.resolve({
    ok: true,
    status: 'working',
    sourceStatus: 'working',
    frames: ['assistant-working-1.webp', 'assistant-working-2.webp']
  });

  await renderPromise;

  assert.equal(stage.children.length, 0);
  assert.equal(timers.activeCount(), 0);
});

test('renderState falls back when getFrames returns no frames', async () => {
  const stage = createStageStub();

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working' })]
  }, {
    mascotApi: createMascotApiStub({
      'assistant:working': []
    })
  });

  assert.equal(stage.children[0].children[0].children[0].className, 'mascot-character__fallback');
});

test('renderState falls back when the current frame image fails', async () => {
  const stage = createStageStub();

  await renderState(stage, {
    characters: [createCharacterState({ id: 'assistant', status: 'working' })]
  }, {
    mascotApi: createMascotApiStub({
      'assistant:working': ['assistant-working-1.webp', 'assistant-working-2.webp']
    })
  });

  const visual = stage.children[0].children[0];
  const image = visual.children[0];
  image.dispatchEvent('error');

  assert.equal(visual.children[0].className, 'mascot-character__fallback');
});

test('renderState does not touch node fs APIs and loads frames only through mascotApi.getFrames', async () => {
  const stage = createStageStub();
  const mascotApi = createMascotApiStub({
    'assistant:working': ['assistant-working-1.webp']
  });

  await renderState(stage, {
    characters: [
      createCharacterState({
        id: 'assistant',
        status: 'working',
        theme: 'default'
      })
    ]
  }, {
    mascotApi,
    require: () => {
      throw new Error('renderer should not require node modules');
    }
  });

  assert.deepEqual(mascotApi.calls, [['assistant', 'working']]);
  assert.equal(stage.children[0].children[0].children[0].src, 'assistant-working-1.webp');
});

test('preload bridge exposes getInitialState through ipcRenderer.invoke', async () => {
  const electronStub = createElectronModuleStub();

  loadPreloadWithElectronStub(electronStub);

  assert.equal(typeof electronStub.exposedApi.getInitialState, 'function');
  await electronStub.exposedApi.getInitialState();

  assert.deepEqual(electronStub.invokeCalls, ['mascot:get-state']);
});

test('preload bridge exposes frame, interaction, and character management APIs through ipcRenderer.invoke', async () => {
  const electronStub = createElectronModuleStub();

  loadPreloadWithElectronStub(electronStub);

  assert.equal(typeof electronStub.exposedApi.getFrames, 'function');
  assert.equal(typeof electronStub.exposedApi.updateCharacterPosition, 'function');
  assert.equal(typeof electronStub.exposedApi.setMouseInteraction, 'function');
  assert.equal(typeof electronStub.exposedApi.getThemes, 'function');
  assert.equal(typeof electronStub.exposedApi.updateCharacter, 'function');
  assert.equal(typeof electronStub.exposedApi.deleteCharacter, 'function');

  await electronStub.exposedApi.getFrames('assistant', 'working');
  await electronStub.exposedApi.updateCharacterPosition('assistant', { x: 42, y: 84 });
  await electronStub.exposedApi.setMouseInteraction(true);
  await electronStub.exposedApi.getThemes();
  await electronStub.exposedApi.updateCharacter('assistant', { status: 'busy' });
  await electronStub.exposedApi.deleteCharacter('reviewer');

  assert.deepEqual(electronStub.invokeCalls, [
    'mascot:get-frames',
    'mascot:update-character-position',
    'mascot:set-mouse-interaction',
    'mascot:get-themes',
    'mascot:update-character',
    'mascot:delete-character'
  ]);
});

test('preload bridge validates onStateChange callback type', () => {
  const electronStub = createElectronModuleStub();

  loadPreloadWithElectronStub(electronStub);

  assert.throws(() => {
    electronStub.exposedApi.onStateChange('not-a-function');
  }, /callback function/);
});

test('preload bridge subscribes to mascot:state and unsubscribe removes the listener', () => {
  const electronStub = createElectronModuleStub();
  const seenStates = [];

  loadPreloadWithElectronStub(electronStub);

  const unsubscribe = electronStub.exposedApi.onStateChange((state) => {
    seenStates.push(state);
  });

  assert.equal(typeof unsubscribe, 'function');
  assert.equal(electronStub.onCalls.length, 1);
  assert.equal(electronStub.onCalls[0].channel, 'mascot:state');

  const state = { characters: [{ id: 'assistant', status: 'working' }] };
  electronStub.onCalls[0].handler({ sender: 'ignored' }, state);
  assert.deepEqual(seenStates, [state]);

  unsubscribe();

  assert.equal(electronStub.removeListenerCalls.length, 1);
  assert.equal(electronStub.removeListenerCalls[0].channel, 'mascot:state');
  assert.equal(electronStub.removeListenerCalls[0].handler, electronStub.onCalls[0].handler);
});

function createIpcMainStub(events) {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      events.push({ type: 'ipc-handle', channel });
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      events.push({ type: 'ipc-remove', channel });
      handlers.delete(channel);
    },
    async invoke(channel, ...args) {
      return handlers.get(channel)?.({}, ...args);
    }
  };
}

function createElectronModuleStub() {
  const invokeCalls = [];
  const onCalls = [];
  const removeListenerCalls = [];
  const electronStub = {
    exposedApi: null,
    invokeCalls,
    onCalls,
    removeListenerCalls,
    contextBridge: {
      exposeInMainWorld(name, api) {
        assert.equal(name, 'mascotApi');
        electronStub.exposedApi = api;
      }
    },
    ipcRenderer: {
      async invoke(channel) {
        invokeCalls.push(channel);
        return { characters: [] };
      },
      on(channel, handler) {
        onCalls.push({ channel, handler });
      },
      removeListener(channel, handler) {
        removeListenerCalls.push({ channel, handler });
      }
    }
  };

  return electronStub;
}

function loadPreloadWithElectronStub(electronStub) {
  const preloadPath = require.resolve('../src/preload');
  const originalLoad = require('node:module')._load;
  delete require.cache[preloadPath];

  require('node:module')._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return electronStub;
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    require(preloadPath);
  } finally {
    require('node:module')._load = originalLoad;
  }

  return electronStub.exposedApi;
}

function createCharacterState(overrides) {
  return {
    id: 'assistant',
    name: '助手',
    visible: true,
    x: 0,
    y: 0,
    width: 180,
    zIndex: 1,
    status: 'idle',
    theme: 'default',
    ...overrides
  };
}

function createMascotApiStub(frameMap, overrides = {}) {
  const calls = [];
  const updateCalls = [];
  const updateCharacterPosition = overrides.updateCharacterPosition || (async () => {
    return { ok: true };
  });

  return {
    calls,
    updateCalls,
    async getFrames(characterId, status) {
      calls.push([characterId, status]);
      return {
        ok: true,
        status,
        sourceStatus: status,
        frames: frameMap[`${characterId}:${status}`] ?? []
      };
    },
    async updateCharacterPosition(characterId, position) {
      updateCalls.push([characterId, position]);
      return updateCharacterPosition(characterId, position);
    },
    async getThemes() {
      if (overrides.getThemes) {
        return overrides.getThemes();
      }

      return { ok: true, themes: ['default'] };
    },
    async updateCharacter(characterId, patch) {
      if (overrides.updateCharacter) {
        return overrides.updateCharacter(characterId, patch);
      }

      return { ok: true };
    },
    async deleteCharacter(characterId) {
      if (overrides.deleteCharacter) {
        return overrides.deleteCharacter(characterId);
      }

      return { ok: true };
    },
    async setMouseInteraction(interactive) {
      if (overrides.setMouseInteraction) {
        return overrides.setMouseInteraction(interactive);
      }

      return { ok: true };
    }
  };
}

function flushPromises() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve
  };
}

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const intervals = new Map();
  let mostRecentId = null;

  return {
    setInterval(handler, delay) {
      const id = nextId;
      nextId += 1;
      mostRecentId = id;
      intervals.set(id, {
        id,
        handler,
        delay,
        nextRunAt: now + delay
      });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    tick(ms) {
      const target = now + ms;

      while (true) {
        const next = Array.from(intervals.values())
          .sort((left, right) => left.nextRunAt - right.nextRunAt)[0];

        if (!next || next.nextRunAt > target) {
          break;
        }

        now = next.nextRunAt;
        next.handler();

        if (intervals.has(next.id)) {
          intervals.get(next.id).nextRunAt += next.delay;
        }
      }

      now = target;
    },
    activeCount() {
      return intervals.size;
    },
    lastScheduledId() {
      return mostRecentId;
    }
  };
}

function createStageStub({ width = 1024, height = 768 } = {}) {
  const stage = createElementStub('main');
  stage.characterNodes = new Map();
  stage.clientWidth = width;
  stage.clientHeight = height;
  return stage;
}

function createElementStub(tagName) {
  const listeners = new Map();
  const childNodes = [];
  const classNames = new Set();
  const element = {
    tagName: tagName.toUpperCase(),
    dataset: {},
    style: {},
    get children() {
      return createHtmlCollectionLike(childNodes);
    },
    get className() {
      return Array.from(classNames).join(' ');
    },
    set className(value) {
      classNames.clear();
      for (const className of String(value).split(/\s+/).filter(Boolean)) {
        classNames.add(className);
      }
    },
    classList: {
      add(...tokens) {
        for (const token of tokens) {
          classNames.add(token);
        }
      },
      remove(...tokens) {
        for (const token of tokens) {
          classNames.delete(token);
        }
      },
      contains(token) {
        return classNames.has(token);
      }
    },
    textContent: '',
    attributes: {},
    offsetWidth: 0,
    offsetHeight: 0,
    parentNode: null,
    get parentElement() {
      return this.parentNode;
    },
    pointerCaptureCalls: [],
    releasedPointerCaptureCalls: [],
    append(...nodes) {
      for (const node of nodes) {
        this.appendChild(node);
      }
    },
    appendChild(node) {
      node.parentNode = this;
      childNodes.push(node);
      return node;
    },
    insertBefore(node, referenceNode) {
      node.parentNode = this;
      const index = childNodes.indexOf(referenceNode);
      if (index === -1) {
        childNodes.push(node);
      } else {
        childNodes.splice(index, 0, node);
      }
      return node;
    },
    replaceChildren(...nodes) {
      childNodes.length = 0;
      for (const node of nodes) {
        node.parentNode = this;
        childNodes.push(node);
      }
    },
    removeChild(node) {
      const index = childNodes.indexOf(node);
      if (index >= 0) {
        childNodes.splice(index, 1);
        node.parentNode = null;
      }
      return node;
    },
    remove() {
      this.parentNode?.removeChild(this);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
      this[name] = value;
    },
    addEventListener(type, handler, options = {}) {
      listeners.set(type, { handler, once: Boolean(options.once) });
    },
    setPointerCapture(pointerId) {
      this.pointerCaptureCalls.push(pointerId);
    },
    releasePointerCapture(pointerId) {
      this.releasedPointerCaptureCalls.push(pointerId);
    },
    dispatchEvent(eventOrType) {
      const event = typeof eventOrType === 'string'
        ? { type: eventOrType }
        : { ...eventOrType };
      const entry = listeners.get(event.type);
      if (!entry) {
        return;
      }
      event.currentTarget = this;
      if (!event.target) {
        event.target = this;
      }
      if (typeof event.preventDefault !== 'function') {
        event.preventDefault = () => {};
      }
      entry.handler(event);
      if (entry.once) {
        listeners.delete(event.type);
      }
    },
    ownerDocument: {
      createElement(innerTagName) {
        return createElementStub(innerTagName);
      }
    }
  };

  return element;
}

function createHtmlCollectionLike(nodes) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'length') {
          return nodes.length;
        }

        if (property === Symbol.iterator) {
          return nodes[Symbol.iterator].bind(nodes);
        }

        if (typeof property === 'string' && /^\d+$/.test(property)) {
          return nodes[Number(property)];
        }

        return undefined;
      },
      ownKeys() {
        return nodes.map((_, index) => String(index));
      },
      getOwnPropertyDescriptor(_target, property) {
        if (property === 'length') {
          return {
            configurable: true,
            enumerable: false,
            value: nodes.length,
            writable: false
          };
        }

        if (typeof property === 'string' && /^\d+$/.test(property)) {
          return {
            configurable: true,
            enumerable: true,
            value: nodes[Number(property)],
            writable: false
          };
        }

        return undefined;
      }
    }
  );
}
