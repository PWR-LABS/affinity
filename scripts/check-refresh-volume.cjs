/** Read-only preflight. Never creates a directory beneath /Volumes. */
const { inspectVolume } = require('./lib/refresh-volume-guard.cjs');
const result = inspectVolume();
console.log(JSON.stringify({ ...result, observedAt: new Date().toISOString() }));
// Missing storage is a normal deferral, not a failed data refresh.
// Callers MUST require state === 'ready' before any SSD I/O or publication.
