const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SUPPORTED_FRAME_EXTENSIONS = Object.freeze(['.png', '.webp', '.jpg', '.jpeg']);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function naturalCompare(left, right) {
  return collator.compare(left, right);
}

function toRendererFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function resolveRealPath(directory) {
  try {
    return fs.realpathSync(directory);
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) {
      return null;
    }

    throw error;
  }
}

function isSupportedFrame(fileName) {
  return SUPPORTED_FRAME_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

function readFrameFolder(directory) {
  try {
    const realDirectory = resolveRealPath(directory);

    if (!realDirectory) {
      return [];
    }

    return fs
      .readdirSync(realDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isSupportedFrame(entry.name))
      .map((entry) => entry.name)
      .sort(naturalCompare)
      .map((fileName) => toRendererFileUrl(path.join(realDirectory, fileName)));
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) {
      return [];
    }

    throw error;
  }
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isWithinRealRoot(rootRealPath, candidateRealPath) {
  if (!rootRealPath || !candidateRealPath) {
    return false;
  }

  return isWithinRoot(rootRealPath, candidateRealPath);
}

function resolveChildDirectory(parentDirectory, childName) {
  const candidate = path.resolve(parentDirectory, childName);

  return isWithinRoot(parentDirectory, candidate) ? candidate : null;
}

function discoverFrames({ assetsRoot, theme, status }) {
  const root = path.resolve(assetsRoot);
  const rootRealPath = resolveRealPath(root);
  const themeDirectory = path.resolve(root, theme);
  const themeRealPath = resolveRealPath(themeDirectory);

  if (!isWithinRealRoot(rootRealPath, themeRealPath)) {
    return {
      status,
      sourceStatus: null,
      frames: []
    };
  }

  const statusDirectory = resolveChildDirectory(themeDirectory, status);
  const statusRealPath = statusDirectory ? resolveRealPath(statusDirectory) : null;
  const statusFrames = isWithinRealRoot(themeRealPath, statusRealPath) ? readFrameFolder(statusDirectory) : [];

  if (statusFrames.length > 0) {
    return {
      status,
      sourceStatus: status,
      frames: statusFrames
    };
  }

  if (status !== 'idle') {
    const idleDirectory = resolveChildDirectory(themeDirectory, 'idle');
    const idleRealPath = idleDirectory ? resolveRealPath(idleDirectory) : null;
    const idleFrames = isWithinRealRoot(themeRealPath, idleRealPath) ? readFrameFolder(idleDirectory) : [];

    if (idleFrames.length > 0) {
      return {
        status,
        sourceStatus: 'idle',
        frames: idleFrames
      };
    }
  }

  return {
    status,
    sourceStatus: null,
    frames: []
  };
}

module.exports = {
  SUPPORTED_FRAME_EXTENSIONS,
  discoverFrames,
  naturalCompare,
  readFrameFolder
};
