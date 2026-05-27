const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { discoverFrames } = require('../src/frame-manifest');

const assetsRoot = path.join(__dirname, '..', 'assets', 'mascot');

test('bundled default assets include multiple frames for visible action switching demos', () => {
  const defaultIdle = discoverFrames({ assetsRoot, theme: 'default', status: 'idle' });
  const defaultWorking = discoverFrames({ assetsRoot, theme: 'default', status: 'working' });
  const defaultDone = discoverFrames({ assetsRoot, theme: 'default', status: 'done' });

  assert.equal(defaultIdle.sourceStatus, 'idle');
  assert.equal(defaultWorking.sourceStatus, 'working');
  assert.equal(defaultDone.sourceStatus, 'done');
  assert.ok(defaultIdle.frames.length >= 3);
  assert.ok(defaultWorking.frames.length >= 3);
  assert.ok(defaultDone.frames.length >= 3);
});
