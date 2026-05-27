const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const test = require('node:test');

const {
  SUPPORTED_FRAME_EXTENSIONS,
  discoverFrames,
  naturalCompare,
  readFrameFolder
} = require('../src/frame-manifest');

function makeTempAssets() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frame-manifest-'));
}

function withTempAssets(callback) {
  const root = makeTempAssets();

  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFrame(root, theme, status, fileName) {
  const directory = path.join(root, theme, status);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), 'frame');
}

function getFrameFileName(frameUrl) {
  return path.basename(fileURLToPath(frameUrl));
}

test('SUPPORTED_FRAME_EXTENSIONS contains supported image formats', () => {
  assert.deepEqual(SUPPORTED_FRAME_EXTENSIONS, ['.png', '.webp', '.jpg', '.jpeg']);
});

test('naturalCompare sorts numbered frame names naturally', () => {
  const names = ['0010.png', '0002.png', '0001.png'];

  assert.deepEqual(names.sort(naturalCompare), ['0001.png', '0002.png', '0010.png']);
});

test('readFrameFolder filters non-image files, returns file URLs, and sorts frames naturally', () => {
  withTempAssets((root) => {
    const directory = path.join(root, 'default', 'working');

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '0010.png'), 'frame');
    fs.writeFileSync(path.join(directory, '0002.webp'), 'frame');
    fs.writeFileSync(path.join(directory, '0001.jpeg'), 'frame');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'ignored');

    const frames = readFrameFolder(directory);

    assert.equal(frames.every((frame) => frame.startsWith('file://')), true);
    assert.deepEqual(frames.map(getFrameFileName), ['0001.jpeg', '0002.webp', '0010.png']);
  });
});

test('readFrameFolder treats EACCES and EPERM as empty folders', () => {
  const originalReaddirSync = fs.readdirSync;
  const root = makeTempAssets();
  const directory = path.join(root, 'default', 'working');

  fs.mkdirSync(directory, { recursive: true });

  try {
    fs.readdirSync = () => {
      const error = new Error('blocked');
      error.code = 'EACCES';
      throw error;
    };

    assert.deepEqual(readFrameFolder(directory), []);

    fs.readdirSync = () => {
      const error = new Error('blocked');
      error.code = 'EPERM';
      throw error;
    };

    assert.deepEqual(readFrameFolder(directory), []);
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverFrames returns renderer-loadable file URLs', () => {
  withTempAssets((root) => {
    writeFrame(root, 'default', 'working', '0001.png');

    const result = discoverFrames({ assetsRoot: root, theme: 'default', status: 'working' });

    assert.equal(result.sourceStatus, 'working');
    assert.equal(result.frames.length, 1);
    assert.equal(result.frames[0].startsWith('file://'), true);
    assert.equal(fileURLToPath(result.frames[0]), path.join(root, 'default', 'working', '0001.png'));
  });
});

test('discoverFrames returns status frames when available', () => {
  withTempAssets((root) => {
    writeFrame(root, 'default', 'working', '0010.png');
    writeFrame(root, 'default', 'working', '0002.webp');
    writeFrame(root, 'default', 'working', '0001.jpg');

    const result = discoverFrames({ assetsRoot: root, theme: 'default', status: 'working' });

    assert.equal(result.status, 'working');
    assert.equal(result.sourceStatus, 'working');
    assert.deepEqual(result.frames.map(getFrameFileName), [
      '0001.jpg',
      '0002.webp',
      '0010.png'
    ]);
  });
});

test('discoverFrames falls back to idle when status folder has no frames', () => {
  withTempAssets((root) => {
    fs.mkdirSync(path.join(root, 'default', 'working'), { recursive: true });
    writeFrame(root, 'default', 'idle', '0001.png');

    const result = discoverFrames({ assetsRoot: root, theme: 'default', status: 'working' });

    assert.equal(result.status, 'working');
    assert.equal(result.sourceStatus, 'idle');
    assert.deepEqual(result.frames.map(getFrameFileName), ['0001.png']);
  });
});

test('discoverFrames returns empty frames when status and idle are empty', () => {
  withTempAssets((root) => {
    fs.mkdirSync(path.join(root, 'default', 'working'), { recursive: true });
    fs.mkdirSync(path.join(root, 'default', 'idle'), { recursive: true });

    const result = discoverFrames({ assetsRoot: root, theme: 'default', status: 'working' });

    assert.equal(result.status, 'working');
    assert.equal(result.sourceStatus, null);
    assert.deepEqual(result.frames, []);
  });
});

test('discoverFrames treats missing folders as empty', () => {
  withTempAssets((root) => {
    const result = discoverFrames({ assetsRoot: root, theme: 'default', status: 'working' });

    assert.equal(result.sourceStatus, null);
    assert.deepEqual(result.frames, []);
  });
});

test('discoverFrames rejects path traversal outside assets root', () => {
  withTempAssets((root) => {
    fs.mkdirSync(path.join(root, 'default', 'working'), { recursive: true });

    const result = discoverFrames({ assetsRoot: root, theme: '..', status: 'working' });

    assert.equal(result.sourceStatus, null);
    assert.deepEqual(result.frames, []);
  });
});

test('discoverFrames rejects symlinked status directories that escape assets root', (t) => {
  withTempAssets((root) => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-manifest-outside-'));

    try {
      writeFrame(outsideRoot, 'default', 'working', '0001.png');

      const assetsTheme = path.join(root, 'default');
      const symlinkTarget = path.join(assetsTheme, 'working');

      fs.mkdirSync(assetsTheme, { recursive: true });

      try {
        fs.symlinkSync(path.join(outsideRoot, 'default', 'working'), symlinkTarget, 'junction');
      } catch (error) {
        if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOENT' || error.code === 'UNKNOWN')) {
          t.skip('symlink creation not permitted on this platform');
          return;
        }

        throw error;
      }

      const result = discoverFrames({ assetsRoot: root, theme: 'default', status: 'working' });

      assert.equal(result.sourceStatus, null);
      assert.deepEqual(result.frames, []);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
