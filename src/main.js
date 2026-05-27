const path = require('node:path');
const { HOST, PORT, isValidStatus } = require('./constants');
const { createHttpServer, defaultListThemes } = require('./http-server');
const { discoverFrames } = require('./frame-manifest');
const { createLayoutStore } = require('./layout-store');
const { createOpencodeIntegration, createOpencodeProjectStore } = require('./integrations/opencode');
const { createStateStore } = require('./state-store');

const GET_STATE_CHANNEL = 'mascot:get-state';
const STATE_EVENT_CHANNEL = 'mascot:state';
const GET_FRAMES_CHANNEL = 'mascot:get-frames';
const UPDATE_POSITION_CHANNEL = 'mascot:update-character-position';
const MOUSE_EVENTS_CHANNEL = 'mascot:set-mouse-interaction';
const GET_THEMES_CHANNEL = 'mascot:get-themes';
const UPDATE_CHARACTER_CHANNEL = 'mascot:update-character';
const DELETE_CHARACTER_CHANNEL = 'mascot:delete-character';
const INITIAL_CHARACTERS = Object.freeze([]);

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function getIndexHtmlPath() {
  return path.join(__dirname, 'index.html');
}

function getAssetsRoot() {
  return path.join(__dirname, '..', 'assets', 'mascot');
}

function getBrowserWindowOptions({ preloadPath = getPreloadPath(), workArea } = {}) {
  const bounds = workArea || { x: 0, y: 0, width: 480, height: 320 };

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: Math.min(320, bounds.width),
    minHeight: Math.min(180, bounds.height),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    fullscreenable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  };
}

function createBroadcastState(getWindow) {
  return function broadcastState(state) {
    const window = getWindow();

    if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
      return;
    }

    const { webContents } = window;

    if (!webContents || typeof webContents.isDestroyed !== 'function' || webContents.isDestroyed()) {
      return;
    }

    webContents.send(STATE_EVENT_CHANNEL, state);
  };
}

function createMouseIgnoreController(getWindow) {
  function setIgnoreMouseEvents(ignore) {
    const window = getWindow();

    if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
      return;
    }

    if (typeof window.setIgnoreMouseEvents !== 'function') {
      return;
    }

    window.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
  }

  return {
    ignoreDesktopClicks() {
      setIgnoreMouseEvents(true);
    },
    handleInteraction(payload) {
      setIgnoreMouseEvents(!payload?.interactive);
    }
  };
}

function focusWindow(window) {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
    return;
  }

  if (typeof window.isMinimized === 'function' && window.isMinimized() && typeof window.restore === 'function') {
    window.restore();
  }

  if (typeof window.show === 'function') {
    window.show();
  }

  if (typeof window.focus === 'function') {
    window.focus();
  }
}

function enforceTopMostWindow(window) {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
    return;
  }

  window.setAlwaysOnTop?.(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  window.moveTop?.();
}

function acquireSingleInstanceLock(app, getWindow = () => null, consoleRef = console) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function') {
    return true;
  }

  const hasLock = app.requestSingleInstanceLock();

  if (!hasLock) {
    consoleRef.info?.('Mascot is already running; exiting duplicate instance.');
    app.quit?.();
    return false;
  }

  app.on?.('second-instance', () => {
    focusWindow(getWindow());
  });

  return true;
}

function clampCharacterToWorkArea(character, workArea) {
  if (!workArea || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)) {
    return { ...character };
  }

  const width = Number.isFinite(character.width) && character.width > 0 ? character.width : 160;
  const maxX = Math.max(0, workArea.width - width);
  const maxY = Math.max(0, workArea.height - width);
  const x = Number.isFinite(character.x) ? character.x : 0;
  const y = Number.isFinite(character.y) ? character.y : 0;

  return {
    ...character,
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y))
  };
}

function clampCharactersToWorkArea(characters, workArea) {
  return characters.map((character) => clampCharacterToWorkArea(character, workArea));
}

function clampStoreToWorkArea(store, workArea) {
  if (!store || !workArea) {
    return;
  }

  for (const character of store.getState().characters) {
    const clamped = clampCharacterToWorkArea(character, workArea);

    if (clamped.x !== character.x || clamped.y !== character.y) {
      store.setCharacterPosition(character.id, { x: clamped.x, y: clamped.y });
    }
  }
}

function closeServer(server, consoleRef = console) {
  if (!server || server.listening === false) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
          consoleRef.error('Failed to close mascot server cleanly:', error);
        }

        resolve();
      });
    } catch (error) {
      consoleRef.error('Failed to close mascot server cleanly:', error);
      resolve();
    }
  });
}

async function cleanupWindow(window) {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
    return;
  }

  if (typeof window.close === 'function') {
    window.close();
  }

  if (typeof window.isDestroyed === 'function' && window.isDestroyed()) {
    return;
  }

  if (typeof window.destroy === 'function') {
    window.destroy();
  }
}

function listenServer(server, { host, port }) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.removeListener?.('error', handleError);
      reject(error);
    };

    server.once?.('error', handleError);
    server.listen(port, host, () => {
      server.removeListener?.('error', handleError);
      resolve();
    });
  });
}

function registerStateHandler(ipcMain, getState) {
  if (!ipcMain) {
    return;
  }

  ipcMain.removeHandler(GET_STATE_CHANNEL);
  ipcMain.handle(GET_STATE_CHANNEL, () => getState());
}

function registerFrameHandler(ipcMain, getState, { assetsRoot = getAssetsRoot(), discover = discoverFrames } = {}) {
  if (!ipcMain) {
    return;
  }

  ipcMain.removeHandler(GET_FRAMES_CHANNEL);
  ipcMain.handle(GET_FRAMES_CHANNEL, (_event, characterId, status) => {
    const state = getState?.();
    const character = state?.characters?.find((entry) => entry.id === characterId);

    if (!character || !isValidStatus(status)) {
      return { ok: false, frames: [], sourceStatus: null };
    }

    return {
      ok: true,
      ...discover({ assetsRoot, theme: character.theme, status })
    };
  });
}

function registerPositionHandler(ipcMain, layoutStore, store, broadcastState = () => {}, { opencode = null } = {}) {
  if (!ipcMain) {
    return;
  }

  ipcMain.removeHandler(UPDATE_POSITION_CHANNEL);
  ipcMain.handle(UPDATE_POSITION_CHANNEL, (_event, characterId, position) => {
    const result = layoutStore.savePosition(characterId, position);
    const persistenceResult = result?.ok === true
      ? result
      : opencode?.updateProjectPreferenceForCharacter?.(characterId, position) || result;

    if (!persistenceResult || persistenceResult.ok !== true) {
      return persistenceResult;
    }

    const liveUpdateResult = store?.setCharacterPosition?.(characterId, position);

    if (!liveUpdateResult || liveUpdateResult.ok !== true) {
      return liveUpdateResult;
    }

    const state = store.getState();
    broadcastState(state);

    return persistenceResult;
  });
}

function registerMouseInteractionHandler(ipcMain, mouseIgnoreController) {
  if (!ipcMain) {
    return;
  }

  ipcMain.removeHandler(MOUSE_EVENTS_CHANNEL);
  ipcMain.handle(MOUSE_EVENTS_CHANNEL, (_event, payload) => {
    mouseIgnoreController.handleInteraction(payload);
    return { ok: true };
  });
}

function hasOwn(object, property) {
  return Boolean(object) && Object.hasOwn(object, property);
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

function saveCharacterPreferences(characterId, patch, { layoutStore, opencode }) {
  if (!hasPersistedCharacterPatch(patch)) {
    return { ok: true };
  }

  if (opencode && typeof opencode.updateProjectPreferenceForCharacter === 'function') {
    const projectPreferenceResult = opencode.updateProjectPreferenceForCharacter(characterId, patch);

    if (projectPreferenceResult?.ok === true) {
      return projectPreferenceResult;
    }

    if (projectPreferenceResult && projectPreferenceResult.code !== 'UNKNOWN_CLIENT') {
      return projectPreferenceResult;
    }
  }

  if (!layoutStore) {
    return { ok: true };
  }

  return layoutStore.saveCharacterPreferences(characterId, patch);
}

function registerCharacterManagementHandlers(ipcMain, store, broadcastState = () => {}, { listThemes = defaultListThemes, layoutStore = null, opencode = null } = {}) {
  if (!ipcMain) {
    return;
  }

  ipcMain.removeHandler(GET_THEMES_CHANNEL);
  ipcMain.handle(GET_THEMES_CHANNEL, () => ({ ok: true, themes: listThemes() }));

  ipcMain.removeHandler(UPDATE_CHARACTER_CHANNEL);
  ipcMain.handle(UPDATE_CHARACTER_CHANNEL, (_event, characterId, patch) => {
    const nextPatch = patch || {};
    const persistedPatch = pickPersistedCharacterPatch(nextPatch);

    if (hasPersistedCharacterPatch(persistedPatch)) {
      const persistenceResult = saveCharacterPreferences(characterId, persistedPatch, { layoutStore, opencode });

      if (!persistenceResult || persistenceResult.ok !== true) {
        return persistenceResult;
      }
    }

    const result = store.updateCharacter(characterId, nextPatch);

    if (!result.ok) {
      return result;
    }

    const state = store.getState();
    broadcastState(state);

    return { ok: true, state };
  });

  ipcMain.removeHandler(DELETE_CHARACTER_CHANNEL);
  ipcMain.handle(DELETE_CHARACTER_CHANNEL, (_event, characterId) => {
    const result = store.removeCharacter(characterId);

    if (!result.ok) {
      return result;
    }

    const state = store.getState();
    broadcastState(state);

    return { ok: true, state };
  });
}

function createLifecycle({
  app,
  BrowserWindow,
  screen,
  ipcMain,
  console: consoleRef = console,
  createHttpServer: createServer = createHttpServer,
  createStore = createStateStore,
  createLayoutStore: createLayoutStoreOverride = createLayoutStore,
  createOpencodeProjectStore: createOpencodeProjectStoreOverride = createOpencodeProjectStore,
  createOpencodeIntegration: createOpencodeIntegrationOverride = createOpencodeIntegration,
  assetsRoot = getAssetsRoot()
} = {}) {
  let mainWindow = null;
  let server = null;
  let shutdownPromise = null;
  let opencodeTimer = null;

  const layoutStore = createLayoutStoreOverride({
    userDataPath: app.getPath('userData'),
    characters: INITIAL_CHARACTERS
  });
  const listAvailableThemes = () => defaultListThemes(assetsRoot);
  const store = createStore(layoutStore.apply(INITIAL_CHARACTERS, listAvailableThemes()));
  const broadcastState = createBroadcastState(() => mainWindow);
  const mouseIgnoreController = createMouseIgnoreController(() => mainWindow);
  const opencode = createOpencodeIntegrationOverride({
    store,
    projectStore: createOpencodeProjectStoreOverride({ userDataPath: app.getPath('userData') }),
    listThemes: listAvailableThemes,
    onStateChange: broadcastState
  });

  registerStateHandler(ipcMain, () => store.getState());
  registerFrameHandler(ipcMain, () => store.getState(), { assetsRoot });
  registerPositionHandler(ipcMain, layoutStore, store, broadcastState, { opencode });
  registerMouseInteractionHandler(ipcMain, mouseIgnoreController);
  registerCharacterManagementHandlers(ipcMain, store, broadcastState, {
    layoutStore,
    opencode,
    listThemes: listAvailableThemes
  });

  async function shutdownServer() {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    const serverToClose = server;
    server = null;
    if (opencodeTimer) {
      clearInterval(opencodeTimer);
      opencodeTimer = null;
    }

    shutdownPromise = closeServer(serverToClose, consoleRef).finally(() => {
      shutdownPromise = null;
    });

    return shutdownPromise;
  }

  async function start() {
    const workArea = screen?.getPrimaryDisplay?.().workArea;
    clampStoreToWorkArea(store, workArea);
    mainWindow = new BrowserWindow(getBrowserWindowOptions({ workArea }));
    enforceTopMostWindow(mainWindow);
    mouseIgnoreController.ignoreDesktopClicks();
    mainWindow.once?.('ready-to-show', () => {
      enforceTopMostWindow(mainWindow);
      mainWindow.show?.();
      enforceTopMostWindow(mainWindow);
    });
    mainWindow.on?.('closed', () => {
      mainWindow = null;
    });
    const loadWindowPromise = Promise.resolve(mainWindow.loadFile(getIndexHtmlPath()));

    server = createServer({
      store,
      integrations: { opencode },
      onStateChange: broadcastState,
      onCharacterPreferenceChange(characterId, patch) {
        return saveCharacterPreferences(characterId, patch, { layoutStore, opencode });
      }
    });

    try {
      await listenServer(server, { host: HOST, port: PORT });
      opencodeTimer = setInterval(() => {
        opencode.tickTimers();
        opencode.removeStaleClients();
      }, 1_000);
      opencodeTimer.unref?.();
      await loadWindowPromise;
      broadcastState(store.getState());
    } catch (error) {
      await cleanupWindow(mainWindow);
      await shutdownServer();
      throw error;
    }
  }

  app.on('before-quit', () => {
    shutdownServer().catch((error) => {
      consoleRef.error('Mascot shutdown encountered an unexpected error:', error);
    });
  });

  return {
    start,
    getServer() {
      return server;
    },
    getStore() {
      return store;
    },
    getOpencode() {
      return opencode;
    },
    getWindow() {
      return mainWindow;
    },
    shutdownServer
  };
}

async function bootstrap() {
  const electron = require('electron');
  let lifecycle = null;

  if (!acquireSingleInstanceLock(electron.app, () => lifecycle?.getWindow?.(), console)) {
    return;
  }

  lifecycle = createLifecycle({
    app: electron.app,
    BrowserWindow: electron.BrowserWindow,
    ipcMain: electron.ipcMain,
    screen: electron.screen
  });

  await electron.app.whenReady();
  await lifecycle.start();
}

function shouldBootstrap(runtimeProcess = process) {
  return Boolean(runtimeProcess.versions?.electron);
}

if (shouldBootstrap()) {
  bootstrap().catch((error) => {
    console.error('Failed to start mascot shell:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  GET_STATE_CHANNEL,
  GET_FRAMES_CHANNEL,
  GET_THEMES_CHANNEL,
  MOUSE_EVENTS_CHANNEL,
  UPDATE_CHARACTER_CHANNEL,
  DELETE_CHARACTER_CHANNEL,
  UPDATE_POSITION_CHANNEL,
  STATE_EVENT_CHANNEL,
  acquireSingleInstanceLock,
  bootstrap,
  cleanupWindow,
  closeServer,
  createBroadcastState,
  createLifecycle,
  createMouseIgnoreController,
  clampCharacterToWorkArea,
  clampCharactersToWorkArea,
  clampStoreToWorkArea,
  getAssetsRoot,
  getBrowserWindowOptions,
  getIndexHtmlPath,
  getPreloadPath,
  enforceTopMostWindow,
  listenServer,
  registerCharacterManagementHandlers,
  registerFrameHandler,
  registerMouseInteractionHandler,
  registerPositionHandler,
  registerStateHandler,
  shouldBootstrap
};
