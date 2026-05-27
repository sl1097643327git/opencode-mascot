const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  LAYOUT_FILE_NAME,
  apply,
  applyLayout,
  createLayoutStore,
  isFinitePosition,
  sanitizeLayout
} = require('../src/layout-store');

const characters = Object.freeze([
  Object.freeze({ id: 'assistant', x: 0, y: 0, status: 'idle' }),
  Object.freeze({ id: 'reviewer', x: 200, y: 0, status: 'idle' })
]);

function makeUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-layout-'));
}

function cleanupUserData(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

test('LAYOUT_FILE_NAME uses the persisted character layout filename', () => {
  assert.equal(LAYOUT_FILE_NAME, 'character-layout.json');
});

test('isFinitePosition accepts only finite x and y numbers', () => {
  assert.equal(isFinitePosition({ x: 1, y: 2 }), true);
  assert.equal(isFinitePosition({ x: Number.NaN, y: 2 }), false);
  assert.equal(isFinitePosition({ x: 1, y: Infinity }), false);
  assert.equal(isFinitePosition({ x: '1', y: 2 }), false);
  assert.equal(isFinitePosition(null), false);
});

test('sanitizeLayout keeps only known finite character positions', () => {
  const layout = sanitizeLayout(
    {
      assistant: { x: 42, y: 24 },
      reviewer: { x: 'bad', y: 10 },
      missing: { x: 9, y: 9 }
    },
    new Set(['assistant', 'reviewer'])
  );

  assert.deepEqual(layout, {
    assistant: { x: 42, y: 24 }
  });
});

test('sanitizeLayout keeps valid persisted character preferences', () => {
  const layout = sanitizeLayout(
    {
      assistant: {
        x: 42,
        y: 24,
        name: '自定义助手',
        theme: 'reviewer',
        visible: false,
        showStatus: false,
        width: 240,
        zIndex: 12,
        status: 'working'
      },
      reviewer: {
        x: Number.NaN,
        y: 10,
        name: '',
        theme: '',
        visible: 'yes',
        width: 'wide',
        zIndex: Infinity
      },
      missing: { x: 9, y: 9, name: 'Missing' }
    },
    new Set(['assistant', 'reviewer'])
  );

  assert.deepEqual(layout, {
    assistant: {
      x: 42,
      y: 24,
      name: '自定义助手',
      theme: 'reviewer',
      visible: false,
      showStatus: false,
      width: 240,
      zIndex: 12
    }
  });
});

test('applyLayout merges valid persisted positions into matching characters only', () => {
  const merged = applyLayout(characters, {
    assistant: { x: 42, y: 24 },
    missing: { x: 999, y: 999 },
    reviewer: { x: 'bad', y: 1 }
  });

  assert.equal(merged.find((character) => character.id === 'assistant').x, 42);
  assert.equal(merged.find((character) => character.id === 'assistant').y, 24);
  assert.equal(merged.find((character) => character.id === 'reviewer').x, 200);
  assert.equal(merged.find((character) => character.id === 'reviewer').y, 0);
});

test('applyLayout merges persisted preferences without persisting transient status', () => {
  const merged = applyLayout(characters, {
    assistant: {
      x: 42,
      y: 24,
      name: '自定义助手',
      theme: 'reviewer',
      visible: false,
      showStatus: false,
      width: 240,
      zIndex: 12,
      status: 'working'
    }
  });
  const assistant = merged.find((character) => character.id === 'assistant');

  assert.equal(assistant.x, 42);
  assert.equal(assistant.y, 24);
  assert.equal(assistant.name, '自定义助手');
  assert.equal(assistant.theme, 'reviewer');
  assert.equal(assistant.visible, false);
  assert.equal(assistant.showStatus, false);
  assert.equal(assistant.width, 240);
  assert.equal(assistant.zIndex, 12);
  assert.equal(assistant.status, 'idle');
});

test('applyLayout falls back to default theme when persisted theme is no longer available', () => {
  const merged = applyLayout(
    [
      { id: 'assistant', x: 0, y: 0, status: 'idle', theme: 'default' },
      { id: 'reviewer', x: 200, y: 0, status: 'idle', theme: 'default' }
    ],
    {
      assistant: {
        name: '旧形象角色',
        theme: 'reviewer',
        width: 220
      }
    },
    ['default']
  );
  const assistant = merged.find((character) => character.id === 'assistant');

  assert.equal(assistant.name, '旧形象角色');
  assert.equal(assistant.theme, 'default');
  assert.equal(assistant.width, 220);
});

test('apply uses the persisted layout snapshot when merging characters', () => {
  const applied = apply(characters, {
    assistant: { x: 11, y: 22 }
  });

  assert.equal(applied.find((character) => character.id === 'assistant').x, 11);
  assert.equal(applied.find((character) => character.id === 'assistant').y, 22);
});

test('createLayoutStore reads valid persisted layout', () => {
  const userDataPath = makeUserData();

  try {
    fs.writeFileSync(path.join(userDataPath, LAYOUT_FILE_NAME), JSON.stringify({
      reviewer: { x: 300, y: 80 }
    }));

    const store = createLayoutStore({ userDataPath, characters });

    assert.deepEqual(store.readLayout(), { reviewer: { x: 300, y: 80 } });
  } finally {
    cleanupUserData(userDataPath);
    assert.equal(fs.existsSync(userDataPath), false);
  }
});

test('createLayoutStore ignores invalid persisted layout', () => {
  const userDataPath = makeUserData();

  try {
    fs.writeFileSync(path.join(userDataPath, LAYOUT_FILE_NAME), '{bad json');

    const store = createLayoutStore({ userDataPath, characters });

    assert.deepEqual(store.readLayout(), {});
  } finally {
    cleanupUserData(userDataPath);
    assert.equal(fs.existsSync(userDataPath), false);
  }
});

test('savePosition writes only known finite positions', () => {
  const userDataPath = makeUserData();

  try {
    const store = createLayoutStore({ userDataPath, characters });

    assert.deepEqual(store.savePosition('assistant', { x: 12, y: 34 }), { ok: true, layout: { assistant: { x: 12, y: 34 } } });
    assert.deepEqual(store.savePosition('missing', { x: 12, y: 34 }), { ok: false, code: 'UNKNOWN_CHARACTER', message: 'Unknown character: missing' });
    assert.deepEqual(store.savePosition('assistant', { x: '12', y: 34 }), { ok: false, code: 'INVALID_POSITION', message: 'Invalid position for character: assistant' });

    const saved = JSON.parse(fs.readFileSync(path.join(userDataPath, LAYOUT_FILE_NAME), 'utf8'));
    assert.deepEqual(saved, { assistant: { x: 12, y: 34 } });

    const savedContent = fs.readFileSync(path.join(userDataPath, LAYOUT_FILE_NAME), 'utf8');
    assert.equal(savedContent.endsWith('\n'), true);
  } finally {
    cleanupUserData(userDataPath);
    assert.equal(fs.existsSync(userDataPath), false);
  }
});

test('saveCharacterPreferences preserves existing position while saving editable fields', () => {
  const userDataPath = makeUserData();

  try {
    const store = createLayoutStore({ userDataPath, characters });

    assert.deepEqual(store.savePosition('assistant', { x: 12, y: 34 }), {
      ok: true,
      layout: { assistant: { x: 12, y: 34 } }
    });
    assert.deepEqual(store.saveCharacterPreferences('assistant', {
      name: '新的文本',
      theme: 'reviewer',
      visible: false,
      showStatus: false,
      width: 220,
      zIndex: 8,
      status: 'busy'
    }), {
      ok: true,
      layout: {
        assistant: {
          x: 12,
          y: 34,
          name: '新的文本',
          theme: 'reviewer',
          visible: false,
          showStatus: false,
          width: 220,
          zIndex: 8
        }
      }
    });

    const saved = JSON.parse(fs.readFileSync(path.join(userDataPath, LAYOUT_FILE_NAME), 'utf8'));
    assert.deepEqual(saved, {
      assistant: {
        x: 12,
        y: 34,
        name: '新的文本',
        theme: 'reviewer',
        visible: false,
        showStatus: false,
        width: 220,
        zIndex: 8
      }
    });
  } finally {
    cleanupUserData(userDataPath);
  }
});

test('saveCharacterPreferences rejects unknown characters and invalid editable fields', () => {
  const userDataPath = makeUserData();

  try {
    const store = createLayoutStore({ userDataPath, characters });

    assert.deepEqual(store.saveCharacterPreferences('missing', { name: 'Missing' }), {
      ok: false,
      code: 'UNKNOWN_CHARACTER',
      message: 'Unknown character: missing'
    });
    assert.deepEqual(store.saveCharacterPreferences('assistant', { width: 'wide' }), {
      ok: false,
      code: 'INVALID_PREFERENCES',
      message: 'Invalid preferences for character: assistant'
    });
  } finally {
    cleanupUserData(userDataPath);
  }
});

test('store.apply uses the persisted layout for characters', () => {
  const userDataPath = makeUserData();

  try {
    fs.writeFileSync(path.join(userDataPath, LAYOUT_FILE_NAME), JSON.stringify({
      assistant: { x: 77, y: 88 }
    }, null, 2));

    const store = createLayoutStore({ userDataPath, characters });
    const applied = store.apply(characters);

    assert.equal(applied.find((character) => character.id === 'assistant').x, 77);
    assert.equal(applied.find((character) => character.id === 'assistant').y, 88);
    assert.equal(applied.find((character) => character.id === 'reviewer').x, 200);
    assert.equal(applied.find((character) => character.id === 'reviewer').y, 0);
  } finally {
    cleanupUserData(userDataPath);
    assert.equal(fs.existsSync(userDataPath), false);
  }
});

test('savePosition uses atomic temp file rename and leaves no temp file behind on success', () => {
  const userDataPath = makeUserData();

  try {
    const store = createLayoutStore({ userDataPath, characters });

    const result = store.savePosition('assistant', { x: 12, y: 34 });

    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userDataPath, LAYOUT_FILE_NAME), 'utf8')), {
      assistant: { x: 12, y: 34 }
    });
    assert.equal(fs.existsSync(path.join(userDataPath, `${LAYOUT_FILE_NAME}.tmp.${process.pid}`)), false);
  } finally {
    cleanupUserData(userDataPath);
    assert.equal(fs.existsSync(userDataPath), false);
  }
});

test('savePosition cleans temp file and preserves existing layout when rename fails', () => {
  const userDataPath = makeUserData();
  const layoutPath = path.join(userDataPath, LAYOUT_FILE_NAME);
  const tempPath = path.join(userDataPath, `${LAYOUT_FILE_NAME}.tmp.${process.pid}`);
  const originalRenameSync = fs.renameSync;

  try {
    fs.writeFileSync(layoutPath, JSON.stringify({ reviewer: { x: 300, y: 80 } }, null, 2));

    fs.renameSync = () => {
      throw new Error('rename failed');
    };

    const store = createLayoutStore({ userDataPath, characters });

    assert.throws(
      () => store.savePosition('assistant', { x: 12, y: 34 }),
      /rename failed/
    );
    assert.equal(fs.existsSync(tempPath), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(layoutPath, 'utf8')), {
      reviewer: { x: 300, y: 80 }
    });
  } finally {
    fs.renameSync = originalRenameSync;
    cleanupUserData(userDataPath);
    assert.equal(fs.existsSync(userDataPath), false);
  }
});

test('savePosition preserves the original rename error when temp cleanup fails', () => {
  const userDataPath = makeUserData();
  const layoutPath = path.join(userDataPath, LAYOUT_FILE_NAME);
  const originalRenameSync = fs.renameSync;
  const originalUnlinkSync = fs.unlinkSync;
  let thrownError;

  try {
    fs.writeFileSync(layoutPath, JSON.stringify({ reviewer: { x: 300, y: 80 } }, null, 2));

    fs.renameSync = () => {
      throw new Error('rename failed');
    };

    fs.unlinkSync = () => {
      throw new Error('cleanup failed');
    };

    const store = createLayoutStore({ userDataPath, characters });

    assert.throws(
      () => store.savePosition('assistant', { x: 12, y: 34 }),
      (error) => {
        thrownError = error;
        return error.message === 'rename failed' && error.cleanupError && error.cleanupError.message === 'cleanup failed';
      }
    );
    assert.equal(thrownError.message, 'rename failed');
    assert.equal(thrownError.cleanupError.message, 'cleanup failed');
    assert.deepEqual(JSON.parse(fs.readFileSync(layoutPath, 'utf8')), {
      reviewer: { x: 300, y: 80 }
    });
  } finally {
    fs.renameSync = originalRenameSync;
    fs.unlinkSync = originalUnlinkSync;
    cleanupUserData(userDataPath);
    assert.equal(fs.existsSync(userDataPath), false);
  }
});

test('savePosition fsyncs the temp file before closing and renaming it', () => {
  const userDataPath = makeUserData();
  const originalOpenSync = fs.openSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalFsyncSync = fs.fsyncSync;
  const originalCloseSync = fs.closeSync;
  const originalRenameSync = fs.renameSync;
  const calls = [];

  try {
    fs.openSync = (filePath, flags) => {
      calls.push(['openSync', path.basename(filePath), flags]);
      return 101;
    };
    fs.writeFileSync = (target, content) => {
      calls.push(['writeFileSync', typeof target === 'number' ? target : path.basename(target), content.includes('assistant')]);
    };
    fs.fsyncSync = (fd) => {
      calls.push(['fsyncSync', fd]);
    };
    fs.closeSync = (fd) => {
      calls.push(['closeSync', fd]);
    };
    fs.renameSync = (fromPath, toPath) => {
      calls.push(['renameSync', path.basename(fromPath), path.basename(toPath)]);
    };

    const store = createLayoutStore({ userDataPath, characters });
    const result = store.savePosition('assistant', { x: 12, y: 34 });

    assert.equal(result.ok, true);
    assert.equal(calls.some((entry) => entry[0] === 'openSync' && entry[2] === 'wx'), true);
    assert.equal(calls.some((entry) => entry[0] === 'writeFileSync' && entry[2] === true), true);
    assert.equal(calls.some((entry) => entry[0] === 'fsyncSync' && entry[1] === 101), true);
    assert.equal(calls.some((entry) => entry[0] === 'closeSync' && entry[1] === 101), true);
    assert.equal(calls.some((entry) => entry[0] === 'renameSync' && entry[2] === LAYOUT_FILE_NAME), true);
    assert.equal(calls.findIndex((entry) => entry[0] === 'writeFileSync') < calls.findIndex((entry) => entry[0] === 'fsyncSync'), true);
    assert.equal(calls.findIndex((entry) => entry[0] === 'fsyncSync') < calls.findIndex((entry) => entry[0] === 'closeSync'), true);
    assert.equal(calls.findIndex((entry) => entry[0] === 'closeSync') < calls.findIndex((entry) => entry[0] === 'renameSync'), true);
  } finally {
    fs.openSync = originalOpenSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.fsyncSync = originalFsyncSync;
    fs.closeSync = originalCloseSync;
    fs.renameSync = originalRenameSync;
    cleanupUserData(userDataPath);
  }
});

test('savePosition attempts to fsync the parent directory after rename when supported', () => {
  const userDataPath = makeUserData();
  const originalOpenSync = fs.openSync;
  const originalFsyncSync = fs.fsyncSync;
  const originalCloseSync = fs.closeSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalRenameSync = fs.renameSync;
  const calls = [];
  let nextFd = 200;

  try {
    fs.openSync = (targetPath, flags) => {
      calls.push(['openSync', targetPath, flags]);
      return nextFd++;
    };
    fs.writeFileSync = () => {};
    fs.renameSync = () => {
      calls.push(['renameSync']);
    };
    fs.fsyncSync = (fd) => {
      calls.push(['fsyncSync', fd]);
    };
    fs.closeSync = (fd) => {
      calls.push(['closeSync', fd]);
    };

    const store = createLayoutStore({ userDataPath, characters });
    store.savePosition('assistant', { x: 12, y: 34 });

    assert.deepEqual(calls.slice(-3), [
      ['openSync', userDataPath, 'r'],
      ['fsyncSync', 201],
      ['closeSync', 201]
    ]);
  } finally {
    fs.openSync = originalOpenSync;
    fs.fsyncSync = originalFsyncSync;
    fs.closeSync = originalCloseSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.renameSync = originalRenameSync;
    cleanupUserData(userDataPath);
  }
});

test('savePosition ignores supported parent directory fsync failures without swallowing unexpected errors silently', () => {
  const userDataPath = makeUserData();
  const originalOpenSync = fs.openSync;
  const originalFsyncSync = fs.fsyncSync;
  const originalCloseSync = fs.closeSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalRenameSync = fs.renameSync;
  let openCount = 0;
  const closed = [];

  try {
    fs.openSync = () => {
      openCount += 1;
      return openCount === 1 ? 301 : 302;
    };
    fs.writeFileSync = () => {};
    fs.renameSync = () => {};
    fs.fsyncSync = (fd) => {
      if (fd === 302) {
        const error = new Error('directory fsync unsupported');
        error.code = 'EINVAL';
        throw error;
      }
    };
    fs.closeSync = (fd) => {
      closed.push(fd);
    };

    const store = createLayoutStore({ userDataPath, characters });

    assert.doesNotThrow(() => {
      store.savePosition('assistant', { x: 12, y: 34 });
    });
    assert.deepEqual(closed, [301, 302]);
  } finally {
    fs.openSync = originalOpenSync;
    fs.fsyncSync = originalFsyncSync;
    fs.closeSync = originalCloseSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.renameSync = originalRenameSync;
    cleanupUserData(userDataPath);
  }
});
