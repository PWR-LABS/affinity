/** Exact NPI membership sets. Source/TIN evidence remains in the verified archive. */
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
export const COMPACT_FORMAT='npi-prefix-v1' as const;
export const COMPACT_LIMITS=Object.freeze({pairs:5_000_000,npis:5_000_000,buckets:10_000,encodedBytes:32_000_000,bucketEncodedBytes:4_100_000,bucketCount:1_000_000,prefixDigits:4});
export function digest(bytes:Uint8Array|string){return createHash('sha256').update(bytes).digest('hex');}
export function encodeBucket(prefix:string,values:readonly number[]){
 if(!/^\d{4}$/.test(prefix)||!values.length||values.length>COMPACT_LIMITS.bucketCount)throw new Error('Invalid compact bucket');
 const raw=Buffer.alloc(values.length*4);let previous=-1;
 for(let i=0;i<values.length;i++){const value=values[i];if(!Number.isSafeInteger(value)||value<0||value>=1_000_000||value<=previous)throw new Error('Compact suffix order invalid');raw.writeUInt32LE(value,i*4);previous=value;}
 const payload=deflateSync(raw);return {prefix,count:values.length,rawSha256:digest(raw),payloadSha256:digest(payload),payload};
}
export function decodeBucket(bucket:{prefix:string;count:number;rawSha256:string;payloadSha256:string;payload:Uint8Array}){
 if(!/^\d{4}$/.test(bucket.prefix)||!Number.isSafeInteger(bucket.count)||bucket.count<1||bucket.count>COMPACT_LIMITS.bucketCount||bucket.payload.length>COMPACT_LIMITS.bucketEncodedBytes||digest(bucket.payload)!==bucket.payloadSha256)throw new Error('Invalid compact bucket metadata');
 const raw=inflateSync(bucket.payload,{maxOutputLength:bucket.count*4});
 if(raw.length!==bucket.count*4||digest(raw)!==bucket.rawSha256)throw new Error('Compact bucket hash mismatch');
 let previous=-1;for(let i=0;i<bucket.count;i++){const value=raw.readUInt32LE(i*4);if(value>=1_000_000||value<=previous)throw new Error('Invalid compact suffix order');previous=value;}
 return raw;
}
export function bucketContains(bucket:Parameters<typeof decodeBucket>[0],npi:string){
 if(!/^\d{10}$/.test(npi)||npi.slice(0,4)!==bucket.prefix)return false;
 const raw=decodeBucket(bucket),target=Number(npi.slice(4));let low=0,high=bucket.count-1;
 while(low<=high){const mid=(low+high)>>>1,value=raw.readUInt32LE(mid*4);if(value===target)return true;if(value<target)low=mid+1;else high=mid-1;}return false;
}
export function compactReservation(encodedBytes:number,buckets:number,plans:number){
 if(![encodedBytes,buckets,plans].every(n=>Number.isSafeInteger(n)&&n>=0)||encodedBytes>COMPACT_LIMITS.encodedBytes||buckets>COMPACT_LIMITS.buckets)throw new Error('Compact capacity limit');
 return encodedBytes*3+buckets*1024+plans*2000+16_000_000;
}
