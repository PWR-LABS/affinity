/** Local processing can grow without expanding the cloud serving allocation. */
export const REFRESH_POLICY = Object.freeze({
  version: '2gb-200k-disk-v4',
  sourceBytes: 2_000_000_000,
  scratchBytes: 4_000_000_000,
  decodedBytes: 64_000_000_000,
  downloadMs: 30 * 60_000,
  extractionMs: 30 * 60_000,
  cycleMs: 4 * 60 * 60_000,
  newFilesPerCycle: 8,
  memberships: 200_000,
  plans: 30_000,
  databaseBytes: 2_500_000_000,
});
/** Reserve the entire possible download, scratch DB and compact output before I/O. */
export function sourceWorkspaceReserve(sourceBytes:number = REFRESH_POLICY.sourceBytes) {
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes <= 0 || sourceBytes > REFRESH_POLICY.sourceBytes) throw new Error('source_size_limit');
  return sourceBytes + REFRESH_POLICY.scratchBytes + 500_000_000;
}
/** Same deliberately conservative reservation as the transactional publication gate. */
export function publicationCapacity(databaseBytes:number,memberships:number,plans:number){
  if (![databaseBytes,memberships,plans].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('Invalid capacity measurement');
  const reservedBytes=memberships*1500+plans*2000;
  return {databaseBytes,memberships,plans,reservedBytes,projectedBytes:databaseBytes+reservedBytes,
    allowed:memberships>0&&memberships<=REFRESH_POLICY.memberships&&plans>0&&plans<=REFRESH_POLICY.plans&&databaseBytes+reservedBytes<=REFRESH_POLICY.databaseBytes,
    limitBytes:REFRESH_POLICY.databaseBytes,cloudResourceChange:false};
}
