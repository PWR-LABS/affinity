import type {Prisma} from '@prisma/client';
import {COMPACT_FORMAT,decodeBucket} from './compact-codec';
import {NpiSetHash,compactManifest,type CompactReceipt} from './compact-archive';
type Db=Pick<Prisma.TransactionClient,'ticNpiIndex'|'ticNpiBucket'|'$queryRaw'>;
/** Full immutable-index readback for publication/rollback, never a count-only acceptance. */
export async function readCompactIndex(db:Db,fileId:string,expected?:{serving:CompactReceipt;membershipCount:number;membershipSha256:string}){
 const index=await db.ticNpiIndex.findUnique({where:{fileId}});if(!index)return null;
 if(index.format!==COMPACT_FORMAT)throw new Error('Unsupported compact index');
 if(expected){const r=expected.serving;if(index.sourceMembershipCount!==expected.membershipCount||index.membershipSha256!==expected.membershipSha256||index.manifestSha256!==r.manifestSha256||index.npiCount!==r.npiCount||index.npiSha256!==r.npiSha256||index.bucketCount!==r.bucketCount||index.encodedBytes!==r.encodedBytes)throw new Error('Compact database identity mismatch');}
 // The normalized source and local manifest have already been validated. Match
 // every stored payload's actual SHA-256 to that exact manifest inside Postgres,
 // avoiding repeated public-network transfer of all compressed bytes on replay.
 if(expected){
  const manifest=await compactManifest(expected.serving);let count=0,bytes=0,after='';
  while(true){
   const page=await db.$queryRaw<Array<{prefix:string;count:number;rawSha256:string;payloadSha256:string;bytes:number;actualSha256:string}>>`SELECT prefix,count,"rawSha256","payloadSha256",octet_length(payload) AS bytes,encode(sha256(payload),'hex') AS "actualSha256" FROM "TicNpiBucket" WHERE "fileId"=${fileId} AND prefix>${after} ORDER BY prefix LIMIT 50`;
   if(!page.length)break;
   for(const bucket of page){const wanted=manifest.buckets[count];if(!wanted||bucket.prefix!==wanted.prefix||bucket.count!==wanted.count||bucket.rawSha256!==wanted.rawSha256||bucket.payloadSha256!==wanted.payloadSha256||bucket.actualSha256!==wanted.payloadSha256||bucket.bytes!==wanted.bytes)throw new Error('Compact database payload mismatch');count++;bytes+=bucket.bytes;after=bucket.prefix;}
  }
  if(count!==index.bucketCount||bytes!==index.encodedBytes)throw new Error('Compact database readback mismatch');return index;
 }
 const set=new NpiSetHash();let count=0,bytes=0,after='';
 while(true){const page=await db.ticNpiBucket.findMany({where:{fileId,prefix:{gt:after}},orderBy:{prefix:'asc'},take:50});if(!page.length)break;
  for(const bucket of page){const raw=decodeBucket(bucket);for(let i=0;i<bucket.count;i++)set.add(bucket.prefix+String(raw.readUInt32LE(i*4)).padStart(6,'0'));bytes+=bucket.payload.length;count++;after=bucket.prefix;}
 }
 if(count!==index.bucketCount||set.count!==index.npiCount||set.finish()!==index.npiSha256||bytes!==index.encodedBytes)throw new Error('Compact database readback mismatch');
 return index;
}
