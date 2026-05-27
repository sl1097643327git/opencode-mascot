const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LAYOUT_FILE_NAME = 'character-layout.json';
const PERSISTED_STRING_FIELDS = new Set(['name', 'theme', 'integrationDetail']);
const PERSISTED_BOOLEAN_FIELDS = new Set(['visible', 'showStatus']);

function isFinitePosition(position) {
  return Boolean(
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y)
  );
}

function sanitizePreferenceEntry(rawPreference) {
  if (!rawPreference || typeof rawPreference !== 'object' || Array.isArray(rawPreference)) {
    return null;
  }

  const preference = {};

  if (isFinitePosition(rawPreference)) {
    preference.x = rawPreference.x;
    preference.y = rawPreference.y;
  }

  for (const field of ['width', 'zIndex']) {
    if (Number.isFinite(rawPreference[field])) {
      preference[field] = rawPreference[field];
    }
  }

  for (const field of PERSISTED_STRING_FIELDS) {
    if (typeof rawPreference[field] === 'string' && rawPreference[field].trim()) {
      preference[field] = rawPreference[field].trim();
    }
  }

  for (const field of PERSISTED_BOOLEAN_FIELDS) {
    if (typeof rawPreference[field] === 'boolean') {
      preference[field] = rawPreference[field];
    }
  }

  if (!Object.keys(preference).length) {
    return null;
  }

  return preference;
}

function sanitizeLayout(rawLayout, knownIds) {
  if (!rawLayout || typeof rawLayout !== 'object' || Array.isArray(rawLayout)) {
    return {};
  }

  const layout = {};

  for (const [characterId, position] of Object.entries(rawLayout)) {
    if (!knownIds.has(characterId)) {
      continue;
    }

    const preference = sanitizePreferenceEntry(position);
    if (!preference) {
      continue;
    }

    layout[characterId] = preference;
  }

  return layout;
}

function normalizeTheme(theme, availableThemes, fallbackTheme) {
  if (!Array.isArray(availableThemes) || availableThemes.length === 0) {
    return theme;
  }

  if (availableThemes.includes(theme)) {
    return theme;
  }

  if (availableThemes.includes(fallbackTheme)) {
    return fallbackTheme;
  }

  return availableThemes[0];
}

function applyLayout(characters, layout, availableThemes = null) {
  return characters.map((character) => {
    const preference = sanitizePreferenceEntry(layout[character.id]);

    if (!preference || typeof preference !== 'object') {
      return {
        ...character,
        theme: normalizeTheme(character.theme, availableThemes, character.theme)
      };
    }

    const merged = {
      ...character,
      ...preference,
      status: character.status
    };

    return {
      ...merged,
      theme: normalizeTheme(merged.theme, availableThemes, character.theme)
    };
  });
}

function apply(characters, layout) {
  return applyLayout(characters, layout);
}

function isIgnorableParentFsyncError(error) {
  return Boolean(error) && ['EINVAL', 'EPERM', 'EISDIR'].includes(error.code);
}

function createLayoutStore({ userDataPath, characters }) {
  const knownIds = new Set(characters.map((character) => character.id));
  const layoutPath = path.join(userDataPath, LAYOUT_FILE_NAME);

  function createTempLayoutPath() {
    const uniqueId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');

    return path.join(userDataPath, `${LAYOUT_FILE_NAME}.tmp.${process.pid}.${uniqueId}`);
  }

  function cleanupTempLayoutFile(tempLayoutPath, originalError) {
    try {
      fs.unlinkSync(tempLayoutPath);
    } catch (cleanupError) {
      if (cleanupError && cleanupError.code === 'ENOENT') {
        return;
      }

      if (originalError && typeof originalError === 'object') {
        originalError.cleanupError = cleanupError;
      }
    }
  }

  function closeFd(fd, closeErrorTarget) {
    if (!Number.isInteger(fd)) {
      return;
    }

    try {
      fs.closeSync(fd);
    } catch (closeError) {
      if (closeErrorTarget && typeof closeErrorTarget === 'object' && !closeErrorTarget.closeError) {
        closeErrorTarget.closeError = closeError;
        return;
      }

      throw closeError;
    }
  }

  function fsyncParentDirectory(directoryPath) {
    let directoryFd;

    try {
      directoryFd = fs.openSync(directoryPath, 'r');
      fs.fsyncSync(directoryFd);
    } catch (error) {
      if (!isIgnorableParentFsyncError(error)) {
        throw error;
      }
    } finally {
      closeFd(directoryFd);
    }
  }

  function readLayout() {
    try {
      const content = fs.readFileSync(layoutPath, 'utf8');
      return sanitizeLayout(JSON.parse(content), knownIds);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return {};
      }

      if (error instanceof SyntaxError) {
        return {};
      }

      throw error;
    }
  }

  function writeLayout(layout) {
    fs.mkdirSync(userDataPath, { recursive: true });
    const tempLayoutPath = createTempLayoutPath();
    const content = `${JSON.stringify(layout, null, 2)}\n`;
    let tempFd;

    try {
      tempFd = fs.openSync(tempLayoutPath, 'wx');
      fs.writeFileSync(tempFd, content);
      fs.fsyncSync(tempFd);
      fs.closeSync(tempFd);
      tempFd = undefined;
      fs.renameSync(tempLayoutPath, layoutPath);
      fsyncParentDirectory(userDataPath);
    } catch (error) {
      closeFd(tempFd, error);
      cleanupTempLayoutFile(tempLayoutPath, error);

      throw error;
    }
  }

  function savePosition(characterId, position) {
    if (!knownIds.has(characterId)) {
      return {
        ok: false,
        code: 'UNKNOWN_CHARACTER',
        message: `Unknown character: ${characterId}`
      };
    }

    if (!isFinitePosition(position)) {
      return {
        ok: false,
        code: 'INVALID_POSITION',
        message: `Invalid position for character: ${characterId}`
      };
    }

    const layout = readLayout();
    layout[characterId] = {
      ...(layout[characterId] || {}),
      x: position.x,
      y: position.y
    };
    writeLayout(layout);

    return { ok: true, layout };
  }

  function saveCharacterPreferences(characterId, patch) {
    if (!knownIds.has(characterId)) {
      return {
        ok: false,
        code: 'UNKNOWN_CHARACTER',
        message: `Unknown character: ${characterId}`
      };
    }

    const preference = sanitizePreferenceEntry(patch);
    if (!preference) {
      return {
        ok: false,
        code: 'INVALID_PREFERENCES',
        message: `Invalid preferences for character: ${characterId}`
      };
    }

    const layout = readLayout();
    layout[characterId] = {
      ...(layout[characterId] || {}),
      ...preference
    };
    writeLayout(layout);

    return { ok: true, layout };
  }

  function apply(charactersToApply, availableThemes = null) {
    return applyLayout(charactersToApply, readLayout(), availableThemes);
  }

  return {
    apply,
    readLayout,
    saveCharacterPreferences,
    savePosition
  };
}

module.exports = {
  LAYOUT_FILE_NAME,
  apply,
  applyLayout,
  createLayoutStore,
  isIgnorableParentFsyncError,
  isFinitePosition,
  normalizeTheme,
  sanitizePreferenceEntry,
  sanitizeLayout
};
