const assert = require('node:assert/strict');
const test = require('node:test');

const { HOST, PORT, STATUSES } = require('../src/constants');

const statusCli = require('../scripts/mascot-status');
const characterCli = require('../scripts/mascot-character');

function createFakeIo() {
  return {
    stdout: { writes: [], write(chunk) { this.writes.push(chunk); } },
    stderr: { writes: [], write(chunk) { this.writes.push(chunk); } }
  };
}

function createFetchStub(response) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) {
      throw response;
    }
    return typeof response === 'function' ? response(url, init) : response;
  };

  return { calls, fetch };
}

test('mascot-status parses status and optional character id', () => {
  assert.deepEqual(statusCli.parseArgs(['working', '--character', 'assistant']), {
    ok: true,
    status: 'working',
    characterId: 'assistant'
  });
});

test('mascot-status rejects invalid status before fetch', async () => {
  const io = createFakeIo();
  const { fetch, calls } = createFetchStub(new Error('should not be called'));

  const exitCode = await statusCli.main(['missing'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stderr.writes.join(''), /Invalid status: missing/);
  assert.match(io.stderr.writes.join(''), new RegExp(STATUSES.join('|')));
});

test('mascot-status posts to the global status endpoint with the provided status', async () => {
  const io = createFakeIo();
  const response = {
    ok: true,
    json: async () => ({ ok: true, state: { globalStatus: 'working' } }),
    text: async () => JSON.stringify({ ok: true })
  };
  const { fetch, calls } = createFetchStub(response);

  const exitCode = await statusCli.main(['working'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `http://${HOST}:${PORT}/status`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.body, JSON.stringify({ status: 'working' }));
  assert.equal(io.stderr.writes.join(''), '');
});

test('mascot-status posts to a character status endpoint when character id is provided', async () => {
  const io = createFakeIo();
  const response = {
    ok: true,
    json: async () => ({ ok: true, state: {} }),
    text: async () => JSON.stringify({ ok: true })
  };
  const { fetch, calls } = createFetchStub(response);

  const exitCode = await statusCli.main(['resting', '--character', 'reviewer'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].url, `http://${HOST}:${PORT}/characters/reviewer/status`);
  assert.equal(calls[0].init.body, JSON.stringify({ status: 'resting' }));
});

test('mascot-status reports network errors as service not running', async () => {
  const io = createFakeIo();
  const { fetch } = createFetchStub(new Error('fetch failed'));

  const exitCode = await statusCli.main(['busy'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 1);
  assert.match(io.stderr.writes.join(''), /fetch failed/);
});

test('mascot-status falls back to service-not-running when fetch throws without a message', async () => {
  const io = createFakeIo();
  const { fetch } = createFetchStub(new Error(''));

  const exitCode = await statusCli.main(['busy'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 1);
  assert.match(io.stderr.writes.join(''), /Service is not running/);
});

test('mascot-character parses show and hide commands', () => {
  assert.deepEqual(characterCli.parseArgs(['show', 'assistant']), {
    ok: true,
    visible: true,
    characterId: 'assistant'
  });

  assert.deepEqual(characterCli.parseArgs(['hide', 'reviewer']), {
    ok: true,
    visible: false,
    characterId: 'reviewer'
  });
});

test('mascot-character rejects invalid visibility command', async () => {
  const io = createFakeIo();
  const { fetch, calls } = createFetchStub(new Error('should not be called'));

  const exitCode = await characterCli.main(['toggle', 'assistant'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0);
  assert.match(io.stderr.writes.join(''), /Invalid visibility: toggle/);
});

test('mascot-character posts visible true or false to the visibility endpoint', async () => {
  const io = createFakeIo();
  const response = {
    ok: true,
    json: async () => ({ ok: true, state: {} }),
    text: async () => JSON.stringify({ ok: true })
  };
  const { fetch, calls } = createFetchStub(response);

  const exitCode = await characterCli.main(['hide', 'assistant'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].url, `http://${HOST}:${PORT}/characters/assistant/visibility`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, JSON.stringify({ visible: false }));
});

test('mascot-character reports HTTP errors from the service', async () => {
  const io = createFakeIo();
  const response = {
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ ok: false, code: 'UNKNOWN_CHARACTER', message: 'Unknown character' })
  };
  const { fetch } = createFetchStub(response);

  const exitCode = await characterCli.main(['show', 'missing'], { fetch, stdout: io.stdout, stderr: io.stderr });

  assert.equal(exitCode, 1);
  assert.match(io.stderr.writes.join(''), /UNKNOWN_CHARACTER/);
  assert.match(io.stderr.writes.join(''), /Unknown character/);
});

test('mascot-character preserves fetch error messages and falls back when missing', async () => {
  const io = createFakeIo();
  const { fetch: failingFetch } = createFetchStub(new Error('socket closed'));

  const failingExitCode = await characterCli.main(['show', 'assistant'], {
    fetch: failingFetch,
    stdout: io.stdout,
    stderr: io.stderr
  });

  assert.equal(failingExitCode, 1);
  assert.match(io.stderr.writes.join(''), /socket closed/);

  const ioWithoutMessage = createFakeIo();
  const { fetch: blankFetch } = createFetchStub(new Error(''));
  const fallbackExitCode = await characterCli.main(['show', 'assistant'], {
    fetch: blankFetch,
    stdout: ioWithoutMessage.stdout,
    stderr: ioWithoutMessage.stderr
  });

  assert.equal(fallbackExitCode, 1);
  assert.match(ioWithoutMessage.stderr.writes.join(''), /Service is not running/);
});
