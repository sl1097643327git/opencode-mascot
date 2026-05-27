const path = require('node:path');
const { isValidStatus } = require('./constants');

const DEFAULT_CHARACTERS = Object.freeze([
  Object.freeze({
    id: 'assistant',
    name: '助手',
    visible: true,
    x: 0,
    y: 0,
    width: 180,
    zIndex: 1,
    status: 'idle',
    theme: 'default'
  }),
  Object.freeze({
    id: 'reviewer',
    name: '审查员',
    visible: true,
    x: 200,
    y: 0,
    width: 180,
    zIndex: 2,
    status: 'idle',
    theme: 'default'
  })
]);

const DEFAULT_THEMES = new Set(DEFAULT_CHARACTERS.map((character) => character.theme));

function assetPathFor(character, status) {
  if (!isValidStatus(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  if (!DEFAULT_THEMES.has(character.theme)) {
    throw new Error(`Invalid theme: ${character.theme}`);
  }

  return path.join('assets', 'mascot', character.theme, `${status}.webp`).replaceAll('\\', '/');
}

module.exports = {
  DEFAULT_CHARACTERS,
  assetPathFor
};
