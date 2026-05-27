const { HOST, PORT } = require('../src/constants');

function getFetch(fetchImpl) {
  return fetchImpl || global.fetch;
}

function parseArgs(argv) {
  const [command, characterId, ...rest] = argv;

  if (!command || !characterId || rest.length > 0) {
    return { ok: false, error: 'Usage: node scripts/mascot-character.js <show|hide> <character-id>' };
  }

  if (command !== 'show' && command !== 'hide') {
    return { ok: false, error: `Invalid visibility: ${command}. Use show or hide.` };
  }

  return {
    ok: true,
    characterId,
    visible: command === 'show'
  };
}

function buildUrl(characterId) {
  return `http://${HOST}:${PORT}/characters/${encodeURIComponent(characterId)}/visibility`;
}

function fallbackCliErrorMessage(defaultMessage, error) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return defaultMessage;
}

async function readErrorMessage(response) {
  const raw = await response.text();

  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.code && parsed.message) {
      return `${parsed.code}: ${parsed.message}`;
    }

    return parsed.code || parsed.message || raw;
  } catch (error) {
    void error;
    return raw;
  }
}

async function sendVisibility(characterId, visible, fetchImpl) {
  const fetchFn = getFetch(fetchImpl);

  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'Service is not running' };
  }

  try {
    const response = await fetchFn(buildUrl(characterId), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ visible })
    });

    if (!response.ok) {
      return { ok: false, error: await readErrorMessage(response) };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: fallbackCliErrorMessage('Service is not running', error) };
  }
}

async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const fetchImpl = io.fetch;
  const parsed = parseArgs(argv);

  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n`);
    return 1;
  }

  const result = await sendVisibility(parsed.characterId, parsed.visible, fetchImpl);

  if (!result.ok) {
    stderr.write(`${result.error}\n`);
    return 1;
  }

  stdout.write(`Updated ${parsed.characterId} visibility to ${parsed.visible}\n`);
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  buildUrl,
  main,
  parseArgs,
  sendVisibility
};
