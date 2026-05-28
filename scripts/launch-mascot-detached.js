const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function launch({ projectRoot = process.argv[2], spawnImpl = spawn } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    return { ok: false, code: 'MISSING_PROJECT_ROOT', message: 'Expected project root argument.' };
  }

  const resolvedRoot = path.resolve(projectRoot);
  if (!fs.existsSync(path.join(resolvedRoot, 'package.json'))) {
    return { ok: false, code: 'MISSING_PACKAGE_JSON', message: `package.json not found in ${resolvedRoot}` };
  }

  const electronBin = process.platform === 'win32'
    ? path.join(resolvedRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(resolvedRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  const electronCli = path.join(resolvedRoot, 'node_modules', 'electron', 'cli.js');
  const fallbackElectronBin = path.join(resolvedRoot, 'node_modules', '.bin', 'electron');
  const fallbackCommand = process.platform === 'win32'
    ? (fs.existsSync(electronCli) ? process.execPath : null)
    : (fs.existsSync(fallbackElectronBin) ? fallbackElectronBin : null);
  const command = fs.existsSync(electronBin) ? electronBin : fallbackCommand;
  const args = fs.existsSync(electronBin)
    ? ['.']
    : process.platform === 'win32'
      ? [electronCli, '.']
      : ['.'];

  if (!fs.existsSync(command)) {
    return { ok: false, code: 'MISSING_ELECTRON', message: `Electron binary not found at ${electronBin}. Run npm install first.` };
  }

  let child;
  try {
    child = spawnImpl(command, args, {
      cwd: resolvedRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
  } catch (error) {
    return {
      ok: false,
      code: 'SPAWN_FAILED',
      message: error instanceof Error ? error.message : `Failed to spawn Electron from ${command}.`
    };
  }

  child.unref?.();
  return { ok: true, pid: child.pid, command, cwd: resolvedRoot };
}

function main(argv = process.argv.slice(2), io = process) {
  const result = launch({ projectRoot: argv[0] });
  if (!result.ok) {
    io.stderr.write(`[ERROR] ${result.message}\n`);
    return 1;
  }

  io.stdout.write(`Started mascot detached: pid=${result.pid || 'unknown'}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { launch, main };
