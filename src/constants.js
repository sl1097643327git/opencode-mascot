const HOST = '127.0.0.1';
const PORT = 17890;

const STATUSES = Object.freeze([
  'idle',
  'working',
  'thinking',
  'typing',
  'tool',
  'permission',
  'busy',
  'resting',
  'done',
  'error'
]);

const DEFAULT_STATUS = 'idle';

function isValidStatus(status) {
  return STATUSES.includes(status);
}

module.exports = {
  DEFAULT_STATUS,
  HOST,
  PORT,
  STATUSES,
  isValidStatus
};
