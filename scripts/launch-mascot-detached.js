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
  const fallbackElectronBin = path.join(resolvedRoot, 'node_modules', '.bin', 'electron');
  const command = fs.existsSync(electronBin) ? electronBin : fallbackElectronBin;

  if (!fs.existsSync(command)) {
    return { ok: false, code: 'MISSING_ELECTRON', message: `Electron binary not found at ${electronBin}. Run npm install first.` };
  }

  const child = spawnImpl(command, ['.'], {
    cwd: resolvedRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
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
