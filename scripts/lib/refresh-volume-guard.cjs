const { execFileSync } = require('node:child_process');
const { statfsSync } = require('node:fs');
const EXPECTED_UUID = 'BCDF3B5E-ECDF-4EE7-BE05-CBA5C58AA5E0';
function assessVolume(info, availableBytes) {
  if (!info || info.Mounted === false || !info.MountPoint) return { state: 'deferred', reason: 'ssd_unavailable' };
  if (info.VolumeUUID !== EXPECTED_UUID || info.MountPoint !== '/Volumes/dev') return { state: 'deferred', reason: 'ssd_identity_mismatch' };
  if (info.WritableVolume === false) return { state: 'deferred', reason: 'ssd_read_only' };
  if (!Number.isFinite(availableBytes) || availableBytes < 150_000_000_000) return { state: 'deferred', reason: 'ssd_free_space_floor' };
  return { state: 'ready', volumeUUID: EXPECTED_UUID, mountPoint: info.MountPoint, availableBytes };
}
function inspectVolume() {
  let info;
  try {
    const plist = execFileSync('/usr/sbin/diskutil', ['info', '-plist', '/Volumes/dev'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }));
  } catch { return assessVolume(null, 0); }
  // Check identity before consulting capacity; never create the mount path.
  const identity = assessVolume(info, 150_000_000_000);
  if (identity.state !== 'ready') return identity;
  try {
    const fs = statfsSync('/Volumes/dev');
    return assessVolume(info, fs.bavail * fs.bsize);
  } catch { return { state: 'deferred', reason: 'ssd_unavailable' }; }
}
module.exports = { EXPECTED_UUID, assessVolume, inspectVolume };
