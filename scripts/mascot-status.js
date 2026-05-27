const { HOST, PORT, STATUSES, isValidStatus } = require('../src/constants');

function getFetch(fetchImpl) {
  return fetchImpl || global.fetch;
}

function parseArgs(argv) {
  const args = [...argv];

  if (args.length === 0) {
    return { ok: false, error: 'Usage: node scripts/mascot-status.js <status> [--character <id>]' };
  }

  const status = args.shift();
  let characterId = null;

  while (args.length > 0) {
    const token = args.shift();

    if (token === '--character') {
      characterId = args.shift();

      if (!characterId) {
        return { ok: false, error: 'Missing value for --character' };
      }

      continue;
    }

    return { ok: false, error: `Unknown argument: ${token}` };
  }

  if (!isValidStatus(status)) {
    return {
      ok: false,
      error: `Invalid status: ${status}. Allowed: ${STATUSES.join(', ')}`
    };
  }

  return { ok: true, status, characterId };
}

function buildUrl(characterId) {
  const path = characterId ? `/characters/${encodeURIComponent(characterId)}/status` : '/status';
  return `http://${HOST}:${PORT}${path}`;
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

async function sendStatus(status, characterId, fetchImpl) {
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
      body: JSON.stringify({ status })
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

  const result = await sendStatus(parsed.status, parsed.characterId, fetchImpl);

  if (!result.ok) {
    stderr.write(`${result.error}\n`);
    return 1;
  }

  stdout.write(`Updated status to ${parsed.status}\n`);
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
  sendStatus
};
