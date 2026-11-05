import {SHARED_PLAN_FORMAT} from '../../src/lib/tic/shared-plans';
import {lstat,realpath,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import type {PrismaClient} from '@prisma/client';
import {COMPACT_FORMAT} from '../../src/lib/tic/compact-codec';
import {buildCompactArchive} from '../../src/lib/tic/compact-archive';
import {rows,validatePublication,type TicPublication} from '../../src/lib/tic/publication';
import {durableJson} from '../../src/lib/tic/source-proof';
/** Local opt-in is installed only after the deployed reader and schema are verified. */
export async function compactServingEnabled(stateRoot:string,db:PrismaClient,fetcher=fetch){
 const path=join(stateRoot,'compact-serving.json');let stat;
 try{stat=await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
 if(!stat.isFile()||(stat.mode&0o077)||stat.uid!==process.getuid?.()||await realpath(path)!==path)throw new Error('Unsafe compact serving configuration');
 const config=JSON.parse(await readFile(path,'utf8'));
 if(config.format!==COMPACT_FORMAT||config.enabled!==true)throw new Error('Invalid compact serving configuration');
 const response=await fetcher('https://affinity.pwr-labs.ai/api/health',{signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!response.ok)throw new Error('Compact serving reader unavailable');const health=await response.json();
 if(health.status!=='ok'||!health.ticServingFormats?.includes(COMPACT_FORMAT))throw new Error('Compact serving reader unavailable');
 await db.ticNpiIndex.findFirst({select:{fileId:true}});return true;
}
/** Preserve the original receipt and authentication; validate the derived exact set. */
export async function deriveCompactPublication(input:TicPublication,path:string,guard:()=>void,archiveKeyPath?:string){
 const original=await validatePublication(input,archiveKeyPath);if(original.serving)return {receipt:original,receiptPath:path};
 const receiptPath=join(dirname(path),'compact-publication.json');
 let existing:unknown;
 try{existing=JSON.parse(await readFile(receiptPath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(existing){const receipt=await validatePublication(existing,archiveKeyPath);const {serving, ...base}=receipt;void serving;if(JSON.stringify(base)!==JSON.stringify(original))throw new Error('Derived receipt identity changed');return {receipt,receiptPath};}
 const serving=await buildCompactArchive(dirname(path),original.membershipSha256,rows(original.membershipPath),guard);
 const receipt=await validatePublication({...original,serving},archiveKeyPath);guard();await durableJson(receiptPath,receipt);return {receipt,receiptPath};
}

/** Separate opt-in; an older web reader must never receive shared plan links. */
export async function sharedPlansEnabled(stateRoot:string,db:PrismaClient,fetcher=fetch){
 const path=join(stateRoot,'shared-plans.json');let s;
 try{s=await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
 if(!s.isFile()||(s.mode&0o077)||s.uid!==process.getuid?.()||await realpath(path)!==path)throw new Error('Unsafe shared plan configuration');
 const config=JSON.parse(await readFile(path,'utf8'));if(config.format!==SHARED_PLAN_FORMAT||config.enabled!==true)throw new Error('Invalid shared plan configuration');
 const response=await fetcher('https://affinity.pwr-labs.ai/api/health',{signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!response.ok)throw new Error('Shared plan reader unavailable');const health=await response.json();
 if(health.status!=='ok'||!health.ticPlanServingFormats?.includes(SHARED_PLAN_FORMAT))throw new Error('Shared plan reader unavailable');
 await db.ticPlanSet.findFirst({select:{id:true}});await db.ticPlanSetEntry.findFirst({select:{setId:true}});await db.ticFilePlanSet.findFirst({select:{fileId:true}});return true;
}
