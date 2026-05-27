const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_CHARACTERS } = require('../src/character-config');
const { assetPathFor } = require('../src/character-config');
const { createStateStore } = require('../src/state-store');

test('initial state contains two visible idle characters', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const state = store.getState();

  assert.equal(state.globalStatus, 'idle');
  assert.equal(state.characters.length, 2);
  assert.deepEqual(
    state.characters.map((character) => [character.id, character.visible, character.status]),
    [
      ['assistant', true, 'idle'],
      ['reviewer', true, 'idle']
    ]
  );
});

test('setGlobalStatus updates only visible characters', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  store.setCharacterVisibility('reviewer', false);
  const result = store.setGlobalStatus('working');
  const state = store.getState();

  assert.equal(result.ok, true);
  assert.equal(state.globalStatus, 'working');
  assert.equal(state.characters.find((character) => character.id === 'assistant').status, 'working');
  assert.equal(state.characters.find((character) => character.id === 'reviewer').status, 'idle');
});

test('setCharacterStatus updates one character', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  const result = store.setCharacterStatus('assistant', 'done');
  const state = store.getState();

  assert.equal(result.ok, true);
  assert.equal(state.characters.find((character) => character.id === 'assistant').status, 'done');
  assert.equal(state.characters.find((character) => character.id === 'reviewer').status, 'idle');
});

test('invalid status is rejected without changing state', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  const result = store.setGlobalStatus('unknown');
  const state = store.getState();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_STATUS');
  assert.equal(state.globalStatus, 'idle');
});

test('unknown character is rejected', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  const result = store.setCharacterStatus('missing', 'done');

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_CHARACTER');
});

test('setCharacterPosition updates one character position', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  const result = store.setCharacterPosition('assistant', { x: 120, y: 240 });
  const state = store.getState();

  assert.equal(result.ok, true);
  assert.deepEqual(
    state.characters.find((character) => character.id === 'assistant'),
    {
      ...DEFAULT_CHARACTERS.find((character) => character.id === 'assistant'),
      x: 120,
      y: 240
    }
  );
  assert.deepEqual(
    state.characters.find((character) => character.id === 'reviewer'),
    DEFAULT_CHARACTERS.find((character) => character.id === 'reviewer')
  );
});

test('setCharacterPosition rejects unknown character without changing state', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const before = store.getState();

  const result = store.setCharacterPosition('missing', { x: 10, y: 20 });
  const after = store.getState();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_CHARACTER');
  assert.deepEqual(after, before);
});

test('setCharacterPosition rejects invalid finite positions without changing state', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const before = store.getState();

  const result = store.setCharacterPosition('assistant', { x: Number.NaN, y: Infinity });
  const after = store.getState();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_POSITION');
  assert.deepEqual(after, before);
});

test('addCharacter appends a new visible mascot with unique id and theme', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const result = store.addCharacter({ id: 'mascot-3', name: '第三只', theme: 'default' });
  const state = store.getState();

  assert.equal(result.ok, true);
  assert.equal(state.characters.length, 3);
  assert.deepEqual(state.characters[2], {
    id: 'mascot-3',
    name: '第三只',
    integrationDetail: '',
    visible: true,
    showStatus: true,
    x: 400,
    y: 0,
    width: 180,
    zIndex: 3,
    status: 'idle',
    theme: 'default'
  });
});

test('addCharacter accepts optional layout fields for integration-created mascots', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const result = store.addCharacter({ id: 'external-1', name: '外部', theme: 'reviewer', x: 320, y: 240, width: 220, zIndex: 9, showStatus: false });
  const character = store.getState().characters.find((entry) => entry.id === 'external-1');

  assert.equal(result.ok, true);
  assert.equal(character.x, 320);
  assert.equal(character.y, 240);
  assert.equal(character.width, 220);
  assert.equal(character.zIndex, 9);
  assert.equal(character.showStatus, false);
});

test('addCharacter rejects duplicate and invalid ids', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  assert.equal(store.addCharacter({ id: 'assistant', name: '重复', theme: 'default' }).code, 'DUPLICATE_CHARACTER');
  assert.equal(store.addCharacter({ id: 'bad id', name: '坏ID', theme: 'default' }).code, 'INVALID_CHARACTER_ID');
});

test('updateCharacter updates label text, theme, status, and visibility', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const result = store.updateCharacter('assistant', {
    name: '新的文本',
    integrationDetail: '接入详情：测试',
    theme: 'reviewer',
    status: 'working',
    visible: false,
    showStatus: false
  });
  const character = store.getState().characters.find((entry) => entry.id === 'assistant');

  assert.equal(result.ok, true);
  assert.equal(character.name, '新的文本');
  assert.equal(character.integrationDetail, '接入详情：测试');
  assert.equal(character.theme, 'reviewer');
  assert.equal(character.status, 'working');
  assert.equal(character.visible, false);
  assert.equal(character.showStatus, false);
});

test('updateCharacter updates optional numeric layout fields', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);
  const result = store.updateCharacter('assistant', { x: 12, y: 34, width: 210, zIndex: 8 });
  const character = store.getState().characters.find((entry) => entry.id === 'assistant');

  assert.equal(result.ok, true);
  assert.equal(character.x, 12);
  assert.equal(character.y, 34);
  assert.equal(character.width, 210);
  assert.equal(character.zIndex, 8);
});

test('removeCharacter deletes an existing mascot and rejects unknown ids', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  assert.equal(store.removeCharacter('assistant').ok, true);
  assert.equal(store.getState().characters.some((character) => character.id === 'assistant'), false);
  assert.equal(store.removeCharacter('missing').code, 'UNKNOWN_CHARACTER');
});

test('invalid visibility is rejected without changing state', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  const before = store.getState();
  const result = store.setCharacterVisibility('assistant', 'yes');
  const after = store.getState();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_VISIBILITY');
  assert.equal(result.message, 'Invalid visibility: yes');
  assert.deepEqual(after, before);
});

test('createStateStore clones input characters', () => {
  const inputCharacters = [
    {
      id: 'assistant',
      name: 'Assistant',
      visible: true,
      x: 1,
      y: 2,
      width: 3,
      zIndex: 4,
      status: 'idle',
      theme: 'default'
    }
  ];

  const store = createStateStore(inputCharacters);
  inputCharacters[0].status = 'done';
  inputCharacters.push({
    id: 'reviewer',
    name: 'Reviewer',
    visible: true,
    x: 5,
    y: 6,
    width: 7,
    zIndex: 8,
    status: 'idle',
    theme: 'reviewer'
  });

  const state = store.getState();

  assert.equal(state.characters.length, 1);
  assert.equal(state.characters[0].status, 'idle');
});

test('getState returns a snapshot that does not mutate internal state', () => {
  const store = createStateStore(DEFAULT_CHARACTERS);

  const snapshot = store.getState();
  snapshot.globalStatus = 'done';
  snapshot.characters[0].status = 'done';
  snapshot.characters.push({
    id: 'new',
    visible: true,
    status: 'done'
  });

  const state = store.getState();

  assert.equal(state.globalStatus, 'idle');
  assert.equal(state.characters.length, 2);
  assert.equal(state.characters[0].status, 'idle');
});

test('assetPathFor returns the expected asset path', () => {
  const result = assetPathFor(DEFAULT_CHARACTERS[0], 'working');

  assert.equal(result, 'assets/mascot/default/working.webp');
});

test('assetPathFor rejects invalid status', () => {
  assert.throws(
    () => assetPathFor(DEFAULT_CHARACTERS[0], 'unknown'),
    /Invalid status: unknown/
  );
});

test('assetPathFor rejects invalid theme', () => {
  assert.throws(
    () => assetPathFor({ ...DEFAULT_CHARACTERS[0], theme: 'unknown-theme' }, 'idle'),
    /Invalid theme: unknown-theme/
  );
});
