const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createStartConfig(projectRoot, platform = process.platform) {
  void platform;
  return {
    startCommand: [process.execPath, path.join(projectRoot, 'scripts', 'launch-mascot-detached.js'), projectRoot]
  };
}

function install({ projectRoot = path.join(__dirname, '..'), homeDir = os.homedir(), platform = process.platform } = {}) {
  const source = path.join(projectRoot, 'plugins', 'opencode-mascot.js');
  const coreSource = path.join(projectRoot, 'plugins', 'opencode-mascot-core.cjs');
  const pluginDir = path.join(homeDir, '.config', 'opencode', 'plugins');
  const configDir = path.dirname(pluginDir);
  const target = path.join(pluginDir, 'mascot.js');
  const coreTarget = path.join(pluginDir, 'opencode-mascot-core.cjs');
  const configPath = path.join(configDir, 'mascot.json');
  const startConfig = createStartConfig(projectRoot, platform);

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.copyFileSync(source, target);
  fs.copyFileSync(coreSource, coreTarget);

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify({
      enabled: true,
      autoStart: true,
      mascotUrl: 'http://127.0.0.1:17890',
      ...startConfig,
      heartbeatMs: 2000
    }, null, 2)}\n`);
  }

  return { target, coreTarget, configPath };
}

function main(argv = process.argv.slice(2), io = process) {
  void argv;
  const result = install();
  io.stdout.write(`Installed opencode mascot plugin: ${result.target}\n`);
  io.stdout.write(`Config: ${result.configPath}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { createStartConfig, install, main };
