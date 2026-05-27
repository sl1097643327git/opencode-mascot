const { HOST, PORT } = require('../src/constants');

const baseUrl = `http://${HOST}:${PORT}`;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

async function patchCharacter(id, body) {
  return request(`/characters/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

async function setCharacterStatus(id, status) {
  return request(`/characters/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
}

async function main() {
  await request('/status');
  await patchCharacter('assistant', { visible: true, name: '助手', theme: 'default' });
  await patchCharacter('reviewer', { visible: true, name: '审查员', theme: 'default' });
  await setCharacterStatus('assistant', 'working');
  await setCharacterStatus('reviewer', 'busy');

  console.log('Quick demo applied. Open http://127.0.0.1:17890 if you want to adjust characters.');
}

main().catch((error) => {
  console.error(error.message);
  console.error('Start the mascot first with `npm start` or `start-mascot.bat`, then rerun this example.');
  process.exitCode = 1;
});
