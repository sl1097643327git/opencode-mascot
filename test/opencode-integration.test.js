const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createStateStore } = require('../src/state-store');
const {
  OPENCODE_PROJECTS_FILE_NAME,
  createOpencodeIntegration,
  createOpencodeProjectStore,
  mapOpencodeEventToDisplay,
  normalizeProjectPath,
  projectKeyFor
} = require('../src/integrations/opencode');

function makeUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-opencode-'));
}

function cleanupUserData(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function createIntegration({ now = 1000, themes = ['default', 'reviewer'] } = {}) {
  const store = createStateStore([]);
  const broadcasts = [];
  const clock = { value: now };
  const integration = createOpencodeIntegration({
    store,
    listThemes: () => themes,
    now: () => clock.value,
    onStateChange: (state) => broadcasts.push(state),
    projectStore: createOpencodeProjectStore({ userDataPath: makeUserData() })
  });

  return { broadcasts, clock, integration, store };
}

test('normalizeProjectPath canonicalizes slashes, drive case, and trailing separators', () => {
  assert.equal(normalizeProjectPath('d:/Project/App/'), 'D:\\Project\\App');
  assert.equal(normalizeProjectPath('D:\\Project\\App\\'), 'D:\\Project\\App');
});

test('projectKeyFor is stable for equivalent project paths', () => {
  assert.equal(projectKeyFor('d:/Project/App/'), projectKeyFor('D:\\Project\\App'));
  assert.match(projectKeyFor('D:\\Project\\App'), /^proj_[a-f0-9]{12}$/);
});

test('createOpencodeProjectStore persists project display preferences atomically', () => {
  const userDataPath = makeUserData();

  try {
    const projectStore = createOpencodeProjectStore({ userDataPath });
    const projectKey = projectKeyFor('D:\\Project\\App');

    projectStore.saveProject(projectKey, {
      projectPath: 'D:\\Project\\App',
      displayName: 'App',
      theme: 'reviewer',
      x: 300,
      y: 400,
      width: 200,
      lastUsedAt: 1234
    });

    const reloaded = createOpencodeProjectStore({ userDataPath });
    assert.deepEqual(reloaded.getProject(projectKey), {
      projectPath: 'D:\\Project\\App',
      displayName: 'App',
      theme: 'reviewer',
      x: 300,
      y: 400,
      width: 200,
      lastUsedAt: 1234
    });
    assert.equal(fs.existsSync(path.join(userDataPath, OPENCODE_PROJECTS_FILE_NAME)), true);
  } finally {
    cleanupUserData(userDataPath);
  }
});

test('hello creates one character per opencode client and reuses project theme with offset', () => {
  const { integration, store } = createIntegration();
  const first = integration.hello({
    clientID: 'client-a',
    project: 'D:\\Project\\App',
    worktree: 'D:\\Project\\App',
    serverUrl: 'http://127.0.0.1:4096'
  });

  assert.equal(first.ok, true);
  assert.equal(first.character.id, 'opencode-client-a');
  assert.equal(first.character.name, 'App');
  assert.equal(first.character.integrationDetail, 'opencode 目录：D:\\Project\\App');

  const preferenceResult = integration.updateProjectPreferenceForCharacter('opencode-client-a', { theme: 'reviewer', x: 500, y: 300, width: 220, showStatus: false });
  assert.equal(preferenceResult.project.showStatus, false);

  const second = integration.hello({
    clientID: 'client-b',
    project: 'D:/Project/App/',
    worktree: 'D:/Project/App/',
    serverUrl: 'http://127.0.0.1:4097'
  });
  const characters = store.getState().characters;

  assert.equal(second.ok, true);
  assert.equal(characters.length, 2);
  assert.equal(characters[1].theme, 'reviewer');
  assert.equal(characters[1].width, 220);
  assert.equal(characters[1].showStatus, false);
  assert.equal(characters[1].integrationDetail, 'opencode 目录：D:\\Project\\App');
  assert.equal(characters[1].x, 464);
  assert.equal(characters[1].y, 264);
});

test('heartbeat timeout removes only the stale opencode character', () => {
  const { clock, integration, store } = createIntegration({ now: 1000 });

  integration.hello({ clientID: 'client-a', project: 'D:\\A', worktree: 'D:\\A', serverUrl: 'http://127.0.0.1:4096' });
  integration.hello({ clientID: 'client-b', project: 'D:\\B', worktree: 'D:\\B', serverUrl: 'http://127.0.0.1:4097' });
  clock.value = 2500;
  integration.heartbeat({ clientID: 'client-b', project: 'D:\\B', worktree: 'D:\\B', serverUrl: 'http://127.0.0.1:4097' });
  clock.value = 4001;

  const result = integration.removeStaleClients();
  const characterIds = store.getState().characters.map((character) => character.id);

  assert.deepEqual(result.removed, ['client-a']);
  assert.deepEqual(characterIds, ['opencode-client-b']);
});

test('opencode event mapping drives display state and prevents transient states from sticking', () => {
  const { clock, integration, store } = createIntegration({ now: 1000 });
  integration.hello({ clientID: 'client-a', project: 'D:\\Project\\App', worktree: 'D:\\Project\\App', serverUrl: 'http://127.0.0.1:4096' });

  integration.handleEvent({ clientID: 'client-a', eventType: 'session.status', payload: { sessionID: 'ses', status: { type: 'busy' } } });
  assert.equal(store.getState().characters[0].status, 'working');

  integration.handleEvent({ clientID: 'client-a', eventType: 'message.part.updated', payload: { part: { type: 'reasoning' } } });
  assert.equal(store.getState().characters[0].status, 'thinking');

  clock.value = 6101;
  integration.tickTimers();
  assert.equal(store.getState().characters[0].status, 'working');

  integration.handleEvent({ clientID: 'client-a', eventType: 'message.part.updated', payload: { part: { type: 'text' } } });
  assert.equal(store.getState().characters[0].status, 'typing');

  integration.handleEvent({ clientID: 'client-a', eventType: 'tool.execute.before', payload: { sessionID: 'ses', tool: 'bash' } });
  assert.equal(store.getState().characters[0].status, 'tool');
  assert.equal(store.getState().characters[0].name, 'App');

  integration.handleEvent({ clientID: 'client-a', eventType: 'session.idle', payload: { sessionID: 'ses' } });
  assert.equal(store.getState().characters[0].status, 'done');
  clock.value = 9000;
  integration.tickTimers();
  assert.equal(store.getState().characters[0].status, 'idle');
});

test('opencode event updates keep a manually saved character theme', () => {
  const { integration, store } = createIntegration({ now: 1000, themes: ['default', 'reviewer'] });
  integration.hello({ clientID: 'client-a', project: 'D:\\ThemeDefault', worktree: 'D:\\ThemeDefault', serverUrl: 'http://127.0.0.1:4096' });

  assert.equal(store.getState().characters[0].theme, 'default');

  const saveResult = store.updateCharacter('opencode-client-a', { theme: 'reviewer' });
  assert.equal(saveResult.ok, true);

  integration.handleEvent({ clientID: 'client-a', eventType: 'session.status', payload: { sessionID: 'ses', status: { type: 'busy' } } });

  const character = store.getState().characters.find((entry) => entry.id === 'opencode-client-a');
  assert.equal(character.theme, 'reviewer');
  assert.equal(character.status, 'working');
});

test('opencode project preferences fall back when saved theme is no longer available', () => {
  const userDataPath = makeUserData();

  try {
    const store = createStateStore([]);
    const projectStore = createOpencodeProjectStore({ userDataPath });
    const projectPath = 'D:\\Project\\OldTheme';
    projectStore.saveProject(projectKeyFor(projectPath), {
      projectPath,
      displayName: 'OldTheme',
      theme: 'reviewer',
      width: 220,
      lastUsedAt: 1000
    });
    const integration = createOpencodeIntegration({
      store,
      projectStore,
      listThemes: () => ['default'],
      now: () => 2000
    });

    const result = integration.hello({
      clientID: 'client-a',
      project: projectPath,
      worktree: projectPath,
      serverUrl: 'http://127.0.0.1:4096'
    });

    assert.equal(result.ok, true);
    assert.equal(result.character.theme, 'default');
    assert.equal(result.character.width, 220);
  } finally {
    cleanupUserData(userDataPath);
  }
});

test('opencode event mapping handles events forwarded with properties payloads', () => {
  const { clock, integration, store } = createIntegration({ now: 1000 });
  integration.hello({ clientID: 'client-a', project: 'D:\\Project\\App', worktree: 'D:\\Project\\App', serverUrl: 'http://127.0.0.1:4096' });

  integration.handleEvent({
    clientID: 'client-a',
    eventType: 'session.status',
    payload: { type: 'session.status', properties: { sessionID: 'ses', status: { type: 'busy' } } }
  });
  assert.equal(store.getState().characters[0].status, 'working');

  integration.handleEvent({
    clientID: 'client-a',
    eventType: 'message.part.updated',
    payload: { type: 'message.part.updated', properties: { sessionID: 'ses', part: { type: 'reasoning' }, time: 1001 } }
  });
  assert.equal(store.getState().characters[0].status, 'thinking');

  clock.value = 6101;
  integration.tickTimers();
  assert.equal(store.getState().characters[0].status, 'working');
});

test('permission and error states are only cleared by explicit busy or idle events', () => {
  const { clock, integration, store } = createIntegration({ now: 1000 });
  integration.hello({ clientID: 'client-a', project: 'D:\\Project\\App', worktree: 'D:\\Project\\App', serverUrl: 'http://127.0.0.1:4096' });

  integration.handleEvent({ clientID: 'client-a', eventType: 'permission.asked', payload: { sessionID: 'ses' } });
  assert.equal(store.getState().characters[0].status, 'permission');
  clock.value = 60000;
  integration.tickTimers();
  assert.equal(store.getState().characters[0].status, 'permission');

  integration.handleEvent({ clientID: 'client-a', eventType: 'permission.replied', payload: { sessionID: 'ses' } });
  assert.equal(store.getState().characters[0].status, 'working');

  integration.handleEvent({ clientID: 'client-a', eventType: 'session.status', payload: { sessionID: 'ses', status: { type: 'retry', attempt: 1, message: 'rate limited' } } });
  assert.equal(store.getState().characters[0].status, 'error');
  assert.equal(store.getState().characters[0].name, 'App');

  integration.handleEvent({ clientID: 'client-a', eventType: 'session.status', payload: { sessionID: 'ses', status: { type: 'busy' } } });
  assert.equal(store.getState().characters[0].status, 'working');
});

test('mapOpencodeEventToDisplay exposes deterministic mappings for plugin events', () => {
  assert.deepEqual(mapOpencodeEventToDisplay({ eventType: 'session.status', payload: { status: { type: 'idle' } } }), { status: 'idle', label: '空闲中' });
  assert.deepEqual(mapOpencodeEventToDisplay({ eventType: 'session.status', payload: { status: { type: 'busy' } } }), { status: 'working', label: '正在工作…' });
  assert.deepEqual(mapOpencodeEventToDisplay({ eventType: 'permission.updated', payload: {} }), { status: 'permission', label: '等待你的授权' });
});
