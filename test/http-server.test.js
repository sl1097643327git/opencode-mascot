const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { DEFAULT_CHARACTERS } = require('../src/character-config');
const { createStateStore } = require('../src/state-store');
const { createHttpServer } = require('../src/http-server');
const { createOpencodeIntegration, createOpencodeProjectStore } = require('../src/integrations/opencode');

function request(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body === undefined ? null : JSON.stringify(body);

    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        let raw = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: raw });
        });
      }
    );

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function parseJsonResponse(response) {
  assert.match(response.headers['content-type'], /^application\/json; charset=utf-8/);
  return JSON.parse(response.body);
}

function createTrackedServer(onStateChange) {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const tracker = { calls: 0, lastState: null };
  const server = createHttpServer({
    store,
    onStateChange: (state) => {
      tracker.calls += 1;
      tracker.lastState = state;
      if (onStateChange) {
        onStateChange(state);
      }
    }
  });

  return { server, tracker, store };
}

function createTrackedServerWithOpencode() {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const tracker = { calls: 0, lastState: null };
  const opencode = createOpencodeIntegration({
    store,
    projectStore: createOpencodeProjectStore({ userDataPath: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mascot-http-opencode-')) }),
    onStateChange: (state) => {
      tracker.calls += 1;
      tracker.lastState = state;
    },
    listThemes: () => ['default', 'reviewer'],
    now: () => Date.now()
  });
  const server = createHttpServer({
    store,
    integrations: { opencode },
    onStateChange: (state) => {
      tracker.calls += 1;
      tracker.lastState = state;
    }
  });

  return { server, tracker, store, opencode };
}

test('GET /status returns current state with ok true and 2 characters', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, { method: 'GET', path: '/status' });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.state.characters.length, 2);
    assert.equal(body.state.globalStatus, 'idle');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET / returns mascot control API help', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, { method: 'GET', path: '/' });
    assert.match(response.headers['content-type'], /^text\/html; charset=utf-8/);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /看板娘控制台/);
    assert.match(response.body, /新增看板娘/);
    assert.match(response.body, /形象/);
    assert.match(response.body, /下方文本/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/help returns mascot control API metadata', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, { method: 'GET', path: '/api/help' });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.endpoints.status, 'GET /status');
    assert.equal(body.endpoints.integrationOpencodeHello, undefined);
    assert.deepEqual(body.statuses, ['idle', 'working', 'thinking', 'typing', 'tool', 'permission', 'busy', 'resting', 'done', 'error']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('opencode HTTP routes create, update, inspect, and disconnect client characters', async () => {
  const { server, store, opencode } = createTrackedServerWithOpencode();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const helpResponse = await request(server, { method: 'GET', path: '/api/help' });
    const helpBody = parseJsonResponse(helpResponse);
    assert.equal(helpBody.endpoints.integrationOpencodeHello, 'POST /opencode/client/hello');

    const helloResponse = await request(server, {
      method: 'POST',
      path: '/opencode/client/hello',
      body: { clientID: 'client-a', project: 'D:\\Project\\App', worktree: 'D:\\Project\\App', serverUrl: 'http://127.0.0.1:4096' }
    });
    const helloBody = parseJsonResponse(helloResponse);

    assert.equal(helloResponse.statusCode, 200);
    assert.equal(helloBody.ok, true);
    assert.equal(store.getState().characters.some((character) => character.id === 'opencode-client-a'), true);

    const eventResponse = await request(server, {
      method: 'POST',
      path: '/opencode/event',
      body: { clientID: 'client-a', eventType: 'session.status', payload: { sessionID: 'ses', status: { type: 'busy' } } }
    });
    const eventBody = parseJsonResponse(eventResponse);

    assert.equal(eventBody.ok, true);
    assert.equal(store.getState().characters.find((character) => character.id === 'opencode-client-a').status, 'working');

    const stateResponse = await request(server, { method: 'GET', path: '/opencode/state' });
    const stateBody = parseJsonResponse(stateResponse);
    assert.equal(stateBody.ok, true);
    assert.equal(stateBody.opencode.clients['client-a'].characterID, 'opencode-client-a');

    const disconnectResponse = await request(server, {
      method: 'POST',
      path: '/opencode/client/disconnect',
      body: { clientID: 'client-a' }
    });
    const disconnectBody = parseJsonResponse(disconnectResponse);

    assert.equal(disconnectBody.ok, true);
    assert.equal(store.getState().characters.some((character) => character.id === 'opencode-client-a'), false);
    assert.equal(opencode.getSnapshot().clients['client-a'], undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('opencode HTTP routes reject malformed client payloads', async () => {
  const { server } = createTrackedServerWithOpencode();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/opencode/client/hello',
      body: { project: 'D:\\Project' }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /themes lists resource theme folders', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({
    store,
    listThemes: () => ['default', 'reviewer']
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, { method: 'GET', path: '/themes' });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(body, { ok: true, themes: ['default', 'reviewer'] });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /characters adds a new mascot and PATCH /characters/:id updates label text and theme', async () => {
  const { server, tracker } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addResponse = await request(server, {
      method: 'POST',
      path: '/characters',
      body: { id: 'mascot-3', name: '第三只', theme: 'default' }
    });
    const addBody = parseJsonResponse(addResponse);

    assert.equal(addResponse.statusCode, 200);
    assert.equal(addBody.ok, true);
    assert.equal(addBody.state.characters.length, 3);
    assert.equal(addBody.state.characters[2].name, '第三只');

    const patchResponse = await request(server, {
      method: 'PATCH',
      path: '/characters/mascot-3',
      body: { name: '改过的文本', theme: 'reviewer', status: 'busy', visible: false, width: 224 }
    });
    const patchBody = parseJsonResponse(patchResponse);
    const character = patchBody.state.characters.find((entry) => entry.id === 'mascot-3');

    assert.equal(patchResponse.statusCode, 200);
    assert.equal(character.name, '改过的文本');
    assert.equal(character.theme, 'reviewer');
    assert.equal(character.status, 'busy');
    assert.equal(character.visible, false);
    assert.equal(character.width, 224);
    assert.equal(tracker.calls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PATCH /characters/:id persists editable preferences when persistence callback is provided', async () => {
  const calls = [];
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({
    store,
    onCharacterPreferenceChange(characterId, patch) {
      calls.push([characterId, patch]);
      return { ok: true };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'PATCH',
      path: '/characters/assistant',
      body: { name: '改过的文本', theme: 'reviewer', status: 'busy', width: 224 }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(calls, [
      ['assistant', { name: '改过的文本', theme: 'reviewer', width: 224 }]
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('DELETE /characters/:id removes a mascot and broadcasts state', async () => {
  const { server, tracker } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await request(server, {
      method: 'POST',
      path: '/characters',
      body: { id: 'mascot-3', name: '第三只', theme: 'default' }
    });

    const response = await request(server, { method: 'DELETE', path: '/characters/mascot-3' });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.state.characters.some((character) => character.id === 'mascot-3'), false);
    assert.equal(tracker.calls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /status updates global status', async () => {
  const { server, tracker } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/status',
      body: { status: 'working' }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.state.globalStatus, 'working');
    assert.equal(tracker.calls, 1);
    assert.equal(tracker.lastState.globalStatus, 'working');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /characters/assistant/status updates one character', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/characters/assistant/status',
      body: { status: 'done' }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.state.characters.find((character) => character.id === 'assistant').status, 'done');
    assert.equal(body.state.characters.find((character) => character.id === 'reviewer').status, 'idle');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /characters/reviewer/visibility updates one character', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/characters/reviewer/visibility',
      body: { visible: false }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.state.characters.find((character) => character.id === 'reviewer').visible, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invalid status returns 400 and INVALID_STATUS', async () => {
  const { server } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/status',
      body: { status: 'unknown' }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'INVALID_STATUS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('missing status returns 400 BAD_REQUEST and does not call onStateChange', async () => {
  const { server, tracker } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/status',
      body: {}
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
    assert.equal(body.message, 'Expected string field: status');
    assert.equal(tracker.calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('non-string status returns 400 BAD_REQUEST and does not call onStateChange', async () => {
  const { server, tracker } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/characters/assistant/status',
      body: { status: 123 }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
    assert.equal(body.message, 'Expected string field: status');
    assert.equal(tracker.calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('missing visible returns 400 BAD_REQUEST and does not call onStateChange', async () => {
  const { server, tracker } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/characters/reviewer/visibility',
      body: {}
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
    assert.equal(body.message, 'Expected boolean field: visible');
    assert.equal(tracker.calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('non-boolean visible returns 400 BAD_REQUEST and does not call onStateChange', async () => {
  const { server, tracker } = createTrackedServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/characters/reviewer/visibility',
      body: { visible: 'yes' }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
    assert.equal(body.message, 'Expected boolean field: visible');
    assert.equal(tracker.calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('unknown character returns 404 and UNKNOWN_CHARACTER', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/characters/missing/status',
      body: { status: 'done' }
    });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 404);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'UNKNOWN_CHARACTER');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bad JSON returns 400 BAD_REQUEST', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          host: '127.0.0.1',
          port: address.port,
          path: '/status',
          headers: {
            'content-type': 'application/json'
          }
        },
        (res) => {
          let raw = '';

          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: raw }));
        }
      );

      req.on('error', reject);
      req.end('{not-json');
    });

    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('oversized JSON body returns 400 BAD_REQUEST', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const oversized = `${'x'.repeat(32 * 1024 + 1)}`;

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          host: '127.0.0.1',
          port: address.port,
          path: '/status',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(oversized)
          }
        },
        (res) => {
          let raw = '';

          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: raw }));
        }
      );

      req.on('error', reject);
      req.end(oversized);
    });

    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('no route returns 404 NOT_FOUND', async () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const server = createHttpServer({ store });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await request(server, { method: 'GET', path: '/missing' });
    const body = parseJsonResponse(response);

    assert.equal(response.statusCode, 404);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'NOT_FOUND');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
