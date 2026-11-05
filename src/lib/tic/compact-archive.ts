import {syncDirectory} from './source-proof';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,realpath,lstat,open,rename,unlink,rmdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {z} from 'zod';
import {COMPACT_FORMAT,COMPACT_LIMITS,digest,encodeBucket,decodeBucket} from './compact-codec';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const compactReceiptSchema=z.object({format:z.literal(COMPACT_FORMAT),manifestPath:z.string(),manifestSha256:hash,npiSha256:hash,npiCount:z.number().int().positive().max(COMPACT_LIMITS.npis),bucketCount:z.number().int().positive().max(COMPACT_LIMITS.buckets),encodedBytes:z.number().int().positive().max(COMPACT_LIMITS.encodedBytes)});
export type CompactReceipt=z.infer<typeof compactReceiptSchema>;
const bucketSchema=z.object({prefix:z.string().regex(/^\d{4}$/),count:z.number().int().positive().max(COMPACT_LIMITS.bucketCount),rawSha256:hash,payloadSha256:hash,bytes:z.number().int().positive().max(COMPACT_LIMITS.bucketEncodedBytes)});
export const compactManifestSchema=z.object({version:z.literal(1),format:z.literal(COMPACT_FORMAT),membershipSha256:hash,membershipCount:z.number().int().positive().max(COMPACT_LIMITS.pairs),npiSha256:hash,npiCount:z.number().int().positive().max(COMPACT_LIMITS.npis),encodedBytes:z.number().int().positive().max(COMPACT_LIMITS.encodedBytes),buckets:z.array(bucketSchema).min(1).max(COMPACT_LIMITS.buckets)});
export class NpiSetHash{
 private hash=createHash('sha256');private previous='';count=0;
 add(npi:string){if(!/^\d{10}$/.test(npi)||npi<this.previous)throw new Error('Normalized NPI order invalid');if(npi===this.previous)return false;this.previous=npi;this.hash.update(npi+'\n');this.count++;if(this.count>COMPACT_LIMITS.npis)throw new Error('Compact NPI limit');return true;}
 finish(){return this.hash.digest('hex');}
}
/** Inputs are fully parsed/validated rows, never upstream-selected/truncated NPIs. */
export async function buildCompactArchive(directory:string,membershipSha256:string,input:AsyncIterable<{npi:string}>,guard:()=>void=()=>{}):Promise<CompactReceipt>{
 guard();const root=resolve(directory),owner=await lstat(root);if(!owner.isDirectory()||await realpath(root)!==root)throw new Error('Unsafe compact directory');
 const check=async()=>{guard();const current=await lstat(root);if(current.dev!==owner.dev||current.ino!==owner.ino||await realpath(root)!==root)throw new Error('Compact directory changed');};
 const out=join(root,'npi-prefix-v1'),manifestPath=join(out,'manifest.json');
 // A completed directory can survive a crash before the publication receipt.
 // Recover only after comparing its complete set with the normalized source.
 let exists=false;
 try{
  const stat=await lstat(out);exists=true;if(!stat.isDirectory()||await realpath(out)!==out)throw new Error('Unsafe compact output');
  const saved=await lstat(manifestPath);if(!saved.isFile()||saved.size>4_000_000||await realpath(manifestPath)!==manifestPath)throw new Error('Unsafe compact manifest');
  const bytes=await readFile(manifestPath),manifest=compactManifestSchema.parse(JSON.parse(bytes.toString()));
  const receipt=compactReceiptSchema.parse({format:COMPACT_FORMAT,manifestPath,manifestSha256:digest(bytes),npiSha256:manifest.npiSha256,npiCount:manifest.npiCount,bucketCount:manifest.buckets.length,encodedBytes:manifest.encodedBytes});
  const set=new NpiSetHash();let count=0;for await(const row of input){if(++count>COMPACT_LIMITS.pairs)throw new Error('Local membership limit');set.add(row.npi);if(count%4096===0)await check();}
  await validateCompactArchive(receipt,{membershipSha256,membershipCount:count,npiCount:set.count,npiSha256:set.finish()});await check();return receipt;
 }catch(error){if(exists||(error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 await check();const stage=await mkdtemp(join(root,'.npi-build-')),stageOwner=await lstat(stage),created:Array<{path:string;dev:number;ino:number}>=[];
 const checkStage=async()=>{await check();const current=await lstat(stage);if(current.dev!==stageOwner.dev||current.ino!==stageOwner.ino||await realpath(stage)!==stage)throw new Error('Compact staging directory changed');};
 let installed=false;
 try{
  const buckets:z.infer<typeof bucketSchema>[]=[],set=new NpiSetHash();let prefix='',values:number[]=[],membershipCount=0,encodedBytes=0;
  const write=async(path:string,bytes:Buffer)=>{await checkStage();const f=await open(path,'wx',0o600);const stat=await f.stat();created.push({path,dev:stat.dev,ino:stat.ino});try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}};
  const flush=async()=>{if(!values.length)return;await check();const b=encodeBucket(prefix,values);encodedBytes+=b.payload.length;if(encodedBytes>COMPACT_LIMITS.encodedBytes||buckets.length>=COMPACT_LIMITS.buckets)throw new Error('Compact output limit');await write(join(stage,prefix+'.deflate'),b.payload);buckets.push({prefix,count:b.count,rawSha256:b.rawSha256,payloadSha256:b.payloadSha256,bytes:b.payload.length});values=[];};
  for await(const row of input){if(++membershipCount>COMPACT_LIMITS.pairs)throw new Error('Local membership limit');if(membershipCount%4096===0)await check();if(!set.add(row.npi))continue;const next=row.npi.slice(0,4);if(next!==prefix){await flush();prefix=next;}values.push(Number(row.npi.slice(4)));}await flush();await check();
  const manifest=compactManifestSchema.parse({version:1,format:COMPACT_FORMAT,membershipSha256,membershipCount,npiSha256:set.finish(),npiCount:set.count,encodedBytes,buckets});
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n');await write(join(stage,'manifest.json'),bytes);await syncDirectory(stage);await check();
  // The serialized publisher owns this source directory. Never replace a prior
  // final directory, including an incomplete or unrelated one.
  try{await lstat(out);throw new Error('Compact output already exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await checkStage();await rename(stage,out);installed=true;await syncDirectory(root);await check();
  return compactReceiptSchema.parse({format:COMPACT_FORMAT,manifestPath,manifestSha256:digest(bytes),npiSha256:manifest.npiSha256,npiCount:manifest.npiCount,bucketCount:buckets.length,encodedBytes});
 }catch(error){
  if(!installed)try{await check();const current=await lstat(stage);if(current.dev!==stageOwner.dev||current.ino!==stageOwner.ino||await realpath(stage)!==stage)throw new Error('Compact staging directory changed');for(const file of created){await check();const stat=await lstat(file.path);if(!stat.isFile()||stat.dev!==file.dev||stat.ino!==file.ino||await realpath(file.path)!==file.path)throw new Error('Compact staged file changed');await unlink(file.path);}await rmdir(stage);}catch{if(error instanceof Error)Object.assign(error,{cleanupPending:true,scratchPath:stage});}
  throw error;
 }
}
export async function compactManifest(receipt:CompactReceipt){
 const path=resolve(receipt.manifestPath),stat=await lstat(path);if(!stat.isFile()||stat.size>4_000_000||await realpath(path)!==path)throw new Error('Unsafe compact manifest');
 const bytes=await readFile(path);if(digest(bytes)!==receipt.manifestSha256)throw new Error('Compact manifest hash mismatch');const manifest=compactManifestSchema.parse(JSON.parse(bytes.toString()));
 if(manifest.npiCount!==receipt.npiCount||manifest.npiSha256!==receipt.npiSha256||manifest.buckets.length!==receipt.bucketCount||manifest.encodedBytes!==receipt.encodedBytes)throw new Error('Compact receipt mismatch');return manifest;
}
export async function* compactBuckets(receipt:CompactReceipt){
 const manifest=await compactManifest(receipt),root=dirname(resolve(receipt.manifestPath));let previous='',total=0,bytes=0;const set=new NpiSetHash();
 for(const b of manifest.buckets){if(b.prefix<=previous)throw new Error('Compact prefix order invalid');previous=b.prefix;const path=join(root,b.prefix+'.deflate'),stat=await lstat(path);if(!stat.isFile()||stat.size!==b.bytes||await realpath(path)!==path)throw new Error('Unsafe compact payload');const payload=await readFile(path);const raw=decodeBucket({...b,payload});total+=b.count;bytes+=payload.length;for(let i=0;i<b.count;i++)set.add(b.prefix+String(raw.readUInt32LE(i*4)).padStart(6,'0'));yield {...b,payload};}
 if(total!==manifest.npiCount||bytes!==manifest.encodedBytes||set.finish()!==manifest.npiSha256)throw new Error('Compact index set mismatch');
}
export async function validateCompactArchive(receipt:CompactReceipt,source:{membershipSha256:string;membershipCount:number;npiCount:number;npiSha256:string}){
 const manifest=await compactManifest(receipt);for(const field of ['membershipSha256','membershipCount','npiCount','npiSha256'] as const)if(manifest[field]!==source[field])throw new Error('Compact index differs from complete normalized source');
 for await(const bucket of compactBuckets(receipt))void bucket;
}
