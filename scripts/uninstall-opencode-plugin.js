const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readJsonFile(filePath, { allowMissing = true, label = filePath } = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (allowMissing && error && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${label} is not valid JSON. Please fix it manually and rerun the uninstaller.`);
    }

    throw error;
  }
}

function removePluginEntry({ homeDir = os.homedir(), pluginModulePath }) {
  const configDir = path.join(homeDir, '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');
  fs.mkdirSync(configDir, { recursive: true });

  const current = readJsonFile(configPath, {
    allowMissing: true,
    label: 'opencode.json'
  });
  const existing = Array.isArray(current.plugin)
    ? current.plugin.filter((value) => typeof value === 'string' && value.trim())
    : typeof current.plugin === 'string' && current.plugin.trim()
      ? [current.plugin.trim()]
      : [];

  const nextPlugin = existing.filter((value) => value !== pluginModulePath);
  const removed = nextPlugin.length !== existing.length;

  if (removed || fs.existsSync(configPath)) {
    const next = {
      ...current,
      plugin: nextPlugin
    };
    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  }

  return { configPath, removed };
}

function removeFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.rmSync(filePath, { force: true });
  return true;
}

function uninstall({ homeDir = os.homedir() } = {}) {
  const pluginDir = path.join(homeDir, '.config', 'opencode', 'plugins');
  const target = path.join(pluginDir, 'mascot.js');
  const coreTarget = path.join(pluginDir, 'opencode-mascot-core.cjs');

  const removedTarget = removeFileIfExists(target);
  const removedCoreTarget = removeFileIfExists(coreTarget);
  const opencodeConfig = removePluginEntry({ homeDir, pluginModulePath: target });

  return {
    target,
    coreTarget,
    removedTarget,
    removedCoreTarget,
    opencodeConfigPath: opencodeConfig.configPath,
    removedPluginEntry: opencodeConfig.removed
  };
}

function main(argv = process.argv.slice(2), io = process) {
  void argv;
  const result = uninstall();
  io.stdout.write(`Uninstalled opencode mascot plugin: ${result.target}\n`);
  io.stdout.write(`opencode config: ${result.opencodeConfigPath}\n`);
  io.stdout.write('Preserved mascot.json user settings.\n');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  readJsonFile,
  removePluginEntry,
  removeFileIfExists,
  uninstall,
  main
};
