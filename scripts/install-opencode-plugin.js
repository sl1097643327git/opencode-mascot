const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function uniqueEntries(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function npmCliCandidates(platform = process.platform) {
  const nodeDir = path.dirname(process.execPath);
  const directCommand = platform === 'win32' ? 'npm.cmd' : 'npm';
  const envCliPath = process.env.npm_execpath;
  const bundledCliPath = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const candidates = [{ command: directCommand, args: ['install'] }];

  for (const cliPath of uniqueEntries([envCliPath, bundledCliPath])) {
    candidates.push({
      command: process.execPath,
      args: [cliPath, 'install']
    });
  }

  return candidates;
}

function createStartConfig(projectRoot, platform = process.platform) {
  void platform;
  return {
    startCommand: [process.execPath, path.join(projectRoot, 'scripts', 'launch-mascot-detached.js'), projectRoot]
  };
}

function electronBinaryPath(projectRoot, platform = process.platform) {
  return platform === 'win32'
    ? path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
}

function fallbackElectronBinaryPath(projectRoot) {
  return path.join(projectRoot, 'node_modules', '.bin', 'electron');
}

function hasElectronBinary(projectRoot, platform = process.platform) {
  return fs.existsSync(electronBinaryPath(projectRoot, platform)) || fs.existsSync(fallbackElectronBinaryPath(projectRoot));
}

function installDependenciesIfNeeded({
  projectRoot = path.join(__dirname, '..'),
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  io = process
} = {}) {
  if (hasElectronBinary(projectRoot, platform)) {
    return { installed: false };
  }

  io.stdout.write('[INFO] Installing mascot dependencies with npm install...\n');
  const attempts = [];
  let installed = false;

  for (const candidate of npmCliCandidates(platform)) {
    const result = spawnSyncImpl(candidate.command, candidate.args, {
      cwd: projectRoot,
      stdio: 'inherit'
    });

    if (result.error) {
      attempts.push(`${candidate.command} ${candidate.args.join(' ')}: ${result.error.message}`);
      continue;
    }

    if (result.status !== 0) {
      attempts.push(`${candidate.command} ${candidate.args.join(' ')}: exit code ${result.status ?? 'unknown'}`);
      continue;
    }

    installed = true;
    break;
  }

  if (!installed) {
    throw new Error(`npm install failed. Attempts:\n- ${attempts.join('\n- ')}`);
  }

  if (!hasElectronBinary(projectRoot, platform)) {
    throw new Error('Electron binary is still missing after npm install.');
  }

  return { installed: true };
}

function readJsonFile(filePath, { allowMissing = true, label = filePath } = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (allowMissing && error && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${label} is not valid JSON. Please fix it manually and rerun the installer.`);
    }

    throw error;
  }
}

function ensurePluginConfigured({
  homeDir = os.homedir(),
  pluginModulePath
} = {}) {
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

  if (existing.includes(pluginModulePath)) {
    return { configPath, updated: false };
  }

  const next = {
    ...current,
    plugin: [...existing, pluginModulePath]
  };
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { configPath, updated: true };
}

function install({ projectRoot = path.join(__dirname, '..'), homeDir = os.homedir(), platform = process.platform, io = process, spawnSyncImpl = spawnSync } = {}) {
  const source = path.join(projectRoot, 'plugins', 'opencode-mascot.js');
  const coreSource = path.join(projectRoot, 'plugins', 'opencode-mascot-core.cjs');
  const pluginDir = path.join(homeDir, '.config', 'opencode', 'plugins');
  const configDir = path.dirname(pluginDir);
  const target = path.join(pluginDir, 'mascot.js');
  const coreTarget = path.join(pluginDir, 'opencode-mascot-core.cjs');
  const configPath = path.join(configDir, 'mascot.json');
  const startConfig = createStartConfig(projectRoot, platform);

  installDependenciesIfNeeded({ projectRoot, platform, spawnSyncImpl, io });

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

  const opencodeConfig = ensurePluginConfigured({ homeDir, pluginModulePath: target });

  return { target, coreTarget, configPath, opencodeConfigPath: opencodeConfig.configPath, opencodeConfigUpdated: opencodeConfig.updated };
}

function main(argv = process.argv.slice(2), io = process) {
  void argv;
  const result = install({ io });
  io.stdout.write(`Installed opencode mascot plugin: ${result.target}\n`);
  io.stdout.write(`Config: ${result.configPath}\n`);
  io.stdout.write(`opencode config: ${result.opencodeConfigPath}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  createStartConfig,
  electronBinaryPath,
  fallbackElectronBinaryPath,
  hasElectronBinary,
  npmCliCandidates,
  installDependenciesIfNeeded,
  ensurePluginConfigured,
  install,
  main
};
