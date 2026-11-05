import {COMPACT_LIMITS,compactReservation} from '../../src/lib/tic/compact-codec';
import type {CompactReceipt} from '../../src/lib/tic/compact-archive';
/** Local processing can grow without expanding the cloud serving allocation. */
export const REFRESH_POLICY = Object.freeze({
  version: '5gb-ref-intern-v6',
  sourceBytes: 5_000_000_000,
  scratchBytes: 4_000_000_000,
  decodedBytes: 128_000_000_000,
  downloadMs: 30 * 60_000,
  extractionMs: 2 * 60 * 60_000,
  cycleMs: 4 * 60 * 60_000,
  newFilesPerCycle: 64,
  memberships: 200_000,
  plans: 30_000,
  databaseBytes: 2_500_000_000,
});
/** Interning changes scratch representation, not complete-source acceptance.
 * Keep validated v5 preparations reusable; retry its resource-limit failures.
 * A source's embedded stale date remains stale under either extractor.
 */
export function compatiblePreparedPolicy(previous:string|undefined,compact:boolean):string|undefined {
  const bases=[REFRESH_POLICY.version,'5gb-200k-disk-v5'];
  return previous&&bases.some(base=>previous===base||(compact&&previous===base+'-npi-prefix-v1'))?previous:undefined;
}
export function compatibleSourceBlock(block:{policy:string;reason:string}|undefined,policy:string){
  return !!block&&(block.policy===policy||(
    block.reason==='Source is stale, undated or future-dated'&&
    compatiblePreparedPolicy(block.policy,policy.endsWith('-npi-prefix-v1'))!==undefined));
}
/** Reserve the entire possible download, scratch DB and compact output before I/O. */
export function sourceWorkspaceReserve(sourceBytes:number = REFRESH_POLICY.sourceBytes,compact=false) {
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes <= 0 || sourceBytes > REFRESH_POLICY.sourceBytes) throw new Error('source_size_limit');
  return sourceBytes + (compact?8_000_000_000:REFRESH_POLICY.scratchBytes) + 500_000_000;
}
/** Same deliberately conservative reservation as the transactional publication gate. */
export function publicationCapacity(databaseBytes:number,memberships:number,plans:number,verifiedReplay=false,serving?:CompactReceipt){
  if (![databaseBytes,memberships,plans].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('Invalid capacity measurement');
  const reservedBytes=verifiedReplay?0:serving?compactReservation(serving.encodedBytes,serving.bucketCount,plans):memberships*1500+plans*2000;
  return {databaseBytes,memberships,plans,reservedBytes,projectedBytes:databaseBytes+reservedBytes,
    verifiedReplay,allowed:memberships>0&&memberships<=(serving?COMPACT_LIMITS.pairs:REFRESH_POLICY.memberships)&&plans>0&&plans<=REFRESH_POLICY.plans&&(verifiedReplay||databaseBytes+reservedBytes<=REFRESH_POLICY.databaseBytes),
    limitBytes:REFRESH_POLICY.databaseBytes,cloudResourceChange:false};
}
