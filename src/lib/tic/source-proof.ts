import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {lstat,realpath,readFile,open,rename} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
export const sourceProofKeyPath=join(homedir(),'Library/Application Support/affinity/refresh/source-proof.key');
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const sourceArchiveSchema=z.object({state:z.literal('compacted'),proofPath:z.string(),proofSha256:hash});
export const extractionAcceptanceSchema=z.object({
 sourceSha256:hash,sourceBytes:z.number().int().positive(),membershipSha256:hash,tocSha256:hash,
 files:z.literal(1),pairs_emitted:z.number().int().positive(),schema:z.enum(['v1','v2']),
 remote_refs_fetched:z.literal(0),remote_refs_404:z.literal(0),
 validation:z.object({policy:z.literal('tic-membership-v1-strict'),extractorRevision:hash,jsonEof:z.literal(true),archiveIntegrity:z.literal(true),referenceClosure:z.literal(true),sourceStable:z.literal(true),limits:z.object({maxPairs:z.number().int().positive().max(5000000),maxMs:z.number().int().positive().max(7200000),maxScratchBytes:z.number().int().positive().max(8000000000),maxDecodedBytes:z.number().int().positive().max(128000000000)})})
});
const bodySchema=z.object({version:z.literal(1),purpose:z.literal('affinity-complete-source-v1'),keyId:hash,receiptSha256:hash,verifiedAt:z.string().datetime(),acceptance:z.literal('local-extraction-only; not publication or plan completeness'),rawLifecycle:z.literal('sealed-pending-delete'),extraction:extractionAcceptanceSchema});
const proofSchema=z.object({body:bodySchema,signature:hash});
function digest(value:string|Buffer){return createHash('sha256').update(value).digest('hex');}
export function publicationDigest(receipt:object){const {sourceArchive,serving,...original}=receipt as Record<string,unknown>;void sourceArchive;void serving;return digest(JSON.stringify(original));}
async function key(path:string){
 const s=await lstat(path);
 if(!s.isFile()||(s.mode&0o077)||s.uid!==process.getuid?.()||await realpath(path)!==resolve(path))throw new Error('Unsafe source proof key');
 const bytes=await readFile(path);if(bytes.length!==32)throw new Error('Invalid source proof key');return bytes;
}
export async function verifySourceProofKey(path=sourceProofKeyPath){await key(path);}
/** Owner setup only. Missing keys are never silently recreated by a refresh. */
export async function createSourceProofKey(path=sourceProofKeyPath){
 const parent=await lstat(dirname(path));
 if(!parent.isDirectory()||(parent.mode&0o077)||parent.uid!==process.getuid?.()||await realpath(dirname(path))!==resolve(dirname(path)))throw new Error('Unsafe source proof key directory');
 const f=await open(path,'wx',0o600);try{await f.writeFile(randomBytes(32));await f.sync();}finally{await f.close();}
 await syncDirectory(dirname(path));
}
export async function syncDirectory(path:string){const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
export async function durableJson(path:string,value:unknown){
 const temporary=path+'.'+process.pid+'.tmp';const f=await open(temporary,'wx',0o600);
 try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}
 await rename(temporary,path);await syncDirectory(dirname(path));
}
export async function sealSourceProof(receipt:object,extraction:z.infer<typeof extractionAcceptanceSchema>,proofPath:string,keyPath=sourceProofKeyPath){
 const secret=await key(keyPath);
 const body=bodySchema.parse({version:1,purpose:'affinity-complete-source-v1',keyId:digest(secret),receiptSha256:publicationDigest(receipt),verifiedAt:new Date().toISOString(),acceptance:'local-extraction-only; not publication or plan completeness',rawLifecycle:'sealed-pending-delete',extraction});
 const signature=createHmac('sha256',secret).update(JSON.stringify(body)).digest('hex');
 await durableJson(proofPath,{body,signature});return {state:'compacted' as const,proofPath,proofSha256:digest(await readFile(proofPath))};
}
/** Receipt metadata alone never authorizes a missing raw source. The private key
 * authenticates the exact previously validated receipt; normalized bytes and TOC
 * lineage must still be checked independently by the publication validator. */
export async function verifySourceProof(receipt:object,archive:z.infer<typeof sourceArchiveSchema>,keyPath=sourceProofKeyPath){
 const path=resolve(archive.proofPath),s=await lstat(path);
 if(!s.isFile()||await realpath(path)!==path)throw new Error('Unsafe source proof');
 const bytes=await readFile(path);if(bytes.length>16384||digest(bytes)!==archive.proofSha256)throw new Error('Source proof hash mismatch');
 const proof=proofSchema.parse(JSON.parse(bytes.toString())),secret=await key(keyPath);
 const expected=createHmac('sha256',secret).update(JSON.stringify(proof.body)).digest();
 if(proof.body.keyId!==digest(secret)||!timingSafeEqual(expected,Buffer.from(proof.signature,'hex'))||proof.body.receiptSha256!==publicationDigest(receipt))throw new Error('Source proof authentication mismatch');
}
