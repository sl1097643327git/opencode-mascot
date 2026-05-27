const { DEFAULT_STATUS, isValidStatus } = require('./constants');

const CHARACTER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,48}$/;

function hasOwn(object, property) {
  return Object.hasOwn(object, property);
}

function isFinitePosition(position) {
  return Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.y));
}

function finiteNumberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function cloneCharacter(character) {
  return {
    ...character
  };
}

function cloneState(state) {
  return {
    globalStatus: state.globalStatus,
    characters: state.characters.map(cloneCharacter)
  };
}

function createStateStore(defaultCharacters) {
  let globalStatus = DEFAULT_STATUS;
  let characters = defaultCharacters.map(cloneCharacter);

  function getState() {
    return cloneState({ globalStatus, characters });
  }

  function setCharacterVisibility(characterId, visible) {
    if (typeof visible !== 'boolean') {
      return { ok: false, code: 'INVALID_VISIBILITY', message: `Invalid visibility: ${visible}` };
    }

    const index = characters.findIndex((character) => character.id === characterId);

    if (index === -1) {
      return { ok: false, code: 'UNKNOWN_CHARACTER' };
    }

    characters[index] = {
      ...characters[index],
      visible
    };

    return { ok: true };
  }

  function setCharacterStatus(characterId, status) {
    if (!isValidStatus(status)) {
      return { ok: false, code: 'INVALID_STATUS' };
    }

    const index = characters.findIndex((character) => character.id === characterId);

    if (index === -1) {
      return { ok: false, code: 'UNKNOWN_CHARACTER' };
    }

    characters[index] = {
      ...characters[index],
      status
    };

    return { ok: true };
  }

  function setGlobalStatus(status) {
    if (!isValidStatus(status)) {
      return { ok: false, code: 'INVALID_STATUS' };
    }

    globalStatus = status;
    characters = characters.map((character) => {
      if (!character.visible) {
        return character;
      }

      return {
        ...character,
        status
      };
    });

    return { ok: true };
  }

  function setCharacterPosition(characterId, position) {
    if (!isFinitePosition(position)) {
      return {
        ok: false,
        code: 'INVALID_POSITION',
        message: `Invalid position for character: ${characterId}`
      };
    }

    const index = characters.findIndex((character) => character.id === characterId);

    if (index === -1) {
      return { ok: false, code: 'UNKNOWN_CHARACTER' };
    }

    characters[index] = {
      ...characters[index],
      x: position.x,
      y: position.y
    };

    return { ok: true };
  }

  function addCharacter(input) {
    const id = typeof input?.id === 'string' ? input.id.trim() : '';
    const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : id;
    const theme = typeof input?.theme === 'string' && input.theme.trim() ? input.theme.trim() : 'default';

    if (!CHARACTER_ID_PATTERN.test(id)) {
      return { ok: false, code: 'INVALID_CHARACTER_ID', message: 'Character id must use letters, numbers, underscore, or hyphen.' };
    }

    if (characters.some((character) => character.id === id)) {
      return { ok: false, code: 'DUPLICATE_CHARACTER', message: `Character already exists: ${id}` };
    }

    const index = characters.length;
    const character = {
      id,
      name,
      integrationDetail: typeof input?.integrationDetail === 'string' ? input.integrationDetail.trim() : '',
      visible: true,
      showStatus: input?.showStatus !== false,
      x: finiteNumberOr(input?.x, index * 200),
      y: finiteNumberOr(input?.y, 0),
      width: finiteNumberOr(input?.width, 180),
      zIndex: finiteNumberOr(input?.zIndex, index + 1),
      status: DEFAULT_STATUS,
      theme
    };

    characters = [...characters, character];

    return { ok: true, character: cloneCharacter(character) };
  }

  function updateCharacter(characterId, patch) {
    const index = characters.findIndex((character) => character.id === characterId);

    if (index === -1) {
      return { ok: false, code: 'UNKNOWN_CHARACTER' };
    }

    const nextCharacter = { ...characters[index] };

    if (hasOwn(patch, 'name')) {
      if (typeof patch.name !== 'string' || !patch.name.trim()) {
        return { ok: false, code: 'INVALID_NAME', message: 'Character label text must be a non-empty string.' };
      }
      nextCharacter.name = patch.name.trim();
    }

    if (hasOwn(patch, 'integrationDetail')) {
      if (typeof patch.integrationDetail !== 'string') {
        return { ok: false, code: 'INVALID_INTEGRATION_DETAIL', message: 'Integration detail must be a string.' };
      }
      nextCharacter.integrationDetail = patch.integrationDetail.trim();
    }

    if (hasOwn(patch, 'theme')) {
      if (typeof patch.theme !== 'string' || !patch.theme.trim()) {
        return { ok: false, code: 'INVALID_THEME', message: 'Character theme must be a non-empty string.' };
      }
      nextCharacter.theme = patch.theme.trim();
    }

    if (hasOwn(patch, 'status')) {
      if (!isValidStatus(patch.status)) {
        return { ok: false, code: 'INVALID_STATUS' };
      }
      nextCharacter.status = patch.status;
    }

    if (hasOwn(patch, 'visible')) {
      if (typeof patch.visible !== 'boolean') {
        return { ok: false, code: 'INVALID_VISIBILITY', message: `Invalid visibility: ${patch.visible}` };
      }
      nextCharacter.visible = patch.visible;
    }

    if (hasOwn(patch, 'showStatus')) {
      if (typeof patch.showStatus !== 'boolean') {
        return { ok: false, code: 'INVALID_STATUS_VISIBILITY', message: `Invalid status visibility: ${patch.showStatus}` };
      }
      nextCharacter.showStatus = patch.showStatus;
    }

    for (const numericField of ['x', 'y', 'width', 'zIndex']) {
      if (!hasOwn(patch, numericField)) {
        continue;
      }

      if (!Number.isFinite(patch[numericField])) {
        return { ok: false, code: 'INVALID_NUMBER', message: `Invalid ${numericField}: ${patch[numericField]}` };
      }

      nextCharacter[numericField] = patch[numericField];
    }

    characters[index] = nextCharacter;

    return { ok: true, character: cloneCharacter(nextCharacter) };
  }

  function removeCharacter(characterId) {
    const index = characters.findIndex((character) => character.id === characterId);

    if (index === -1) {
      return { ok: false, code: 'UNKNOWN_CHARACTER' };
    }

    characters = characters.filter((character) => character.id !== characterId);

    return { ok: true };
  }

  return {
    addCharacter,
    getState,
    removeCharacter,
    setCharacterPosition,
    setCharacterStatus,
    setCharacterVisibility,
    setGlobalStatus,
    updateCharacter
  };
}

module.exports = {
  createStateStore
};
