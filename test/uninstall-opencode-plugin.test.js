const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { install } = require('../scripts/install-opencode-plugin');
const { uninstall } = require('../scripts/uninstall-opencode-plugin');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-uninstall-test-'));
}

test('uninstall removes installed plugin files and plugin entry but preserves mascot config', () => {
  const tempHome = createTempDir();
  const installed = install({ homeDir: tempHome });
  fs.writeFileSync(installed.configPath, '{"enabled":false}\n');

  const result = uninstall({ homeDir: tempHome });
  const opencodeConfig = JSON.parse(fs.readFileSync(result.opencodeConfigPath, 'utf8'));

  assert.equal(fs.existsSync(installed.target), false);
  assert.equal(fs.existsSync(installed.coreTarget), false);
  assert.equal(fs.readFileSync(installed.configPath, 'utf8'), '{"enabled":false}\n');
  assert.deepEqual(opencodeConfig.plugin ?? [], []);
  assert.equal(result.removedPluginEntry, true);
});

test('uninstall preserves unrelated plugin entries and is safe to run twice', () => {
  const tempHome = createTempDir();
  const installed = install({ homeDir: tempHome });
  const opencodeConfigPath = path.join(tempHome, '.config', 'opencode', 'opencode.json');
  fs.writeFileSync(opencodeConfigPath, `${JSON.stringify({ plugin: ['existing-plugin.js', installed.target] }, null, 2)}\n`);

  const first = uninstall({ homeDir: tempHome });
  const second = uninstall({ homeDir: tempHome });
  const saved = JSON.parse(fs.readFileSync(opencodeConfigPath, 'utf8'));

  assert.deepEqual(saved.plugin, ['existing-plugin.js']);
  assert.equal(first.removedPluginEntry, true);
  assert.equal(second.removedPluginEntry, false);
});

test('uninstall fails without overwriting malformed opencode.json', () => {
  const tempHome = createTempDir();
  const pluginDir = path.join(tempHome, '.config', 'opencode', 'plugins');
  const configDir = path.join(tempHome, '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'mascot.js'), 'plugin');
  fs.writeFileSync(path.join(pluginDir, 'opencode-mascot-core.cjs'), 'core');
  fs.writeFileSync(configPath, '{ invalid json\n');

  assert.throws(() => uninstall({ homeDir: tempHome }), /opencode\.json/i);
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{ invalid json\n');
});
