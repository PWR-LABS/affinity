import test from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EXPECTED_UUID, assessVolume } = require('../scripts/lib/refresh-volume-guard.cjs');
const good = { WritableVolume: true, MountPoint: '/Volumes/dev', VolumeUUID: EXPECTED_UUID };
test('absent or detached SSD defers without publication', () => {
  assert.equal(assessVolume(null, 0).reason, 'ssd_unavailable');
  assert.equal(assessVolume({ ...good, Mounted: false }, 200e9).state, 'deferred');
});
test('same mount name with wrong disk and correct disk at wrong path both defer', () => {
  assert.equal(assessVolume({ ...good, VolumeUUID: 'other' }, 200e9).reason, 'ssd_identity_mismatch');
  assert.equal(assessVolume({ ...good, MountPoint: '/Volumes/dev 1' }, 200e9).state, 'deferred');
  assert.equal(assessVolume({ ...good, VolumeUUID: 'other' }, 0).reason, 'ssd_identity_mismatch');
  assert.equal(assessVolume({ ...good, WritableVolume: false }, 0).reason, 'ssd_read_only');
});
test('low or unknown capacity defers, restored valid SSD becomes ready', () => {
  for (const bytes of [149e9, NaN, Infinity]) assert.equal(assessVolume(good, bytes).state, 'deferred');
  assert.equal(assessVolume(good, 150e9).state, 'ready');
});

test('read-only volume defers', () => {
  assert.equal(assessVolume({ ...good, WritableVolume: false }, 200e9).reason, 'ssd_read_only');
});
