import {lstat,realpath,readFile,unlink} from 'node:fs/promises';
import {lstatSync,realpathSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {receiptSchema,sha256} from '../../src/lib/tic/publication';
import {durableJson,syncDirectory} from '../../src/lib/tic/source-proof';
/** This receipt is diagnostic only. It can never authenticate publication or a
 * missing accepted source. Only a complete, hashed, unaccepted owned download is
 * reclaimed; ambiguous/partial downloads remain explicit recovery work. */
export async function reclaimRejectedSource(options:{directory:string;ownedRunRoot:string;reason:string;guard:()=>void;retainedReceiptPaths:string[];beforeRemoval?:()=>Promise<void>}){
 const dir=resolve(options.directory),root=resolve(options.ownedRunRoot),source=join(dir,'source.json.gz');
 options.guard();
 if(dirname(dir)!==root||await realpath(root)!==root||await realpath(dir)!==dir)throw new Error('Rejected source outside owned run');
 const owners=[root,dir].map(path=>({path,stat:lstatSync(path,{bigint:true})}));
 const guard=()=>{options.guard();for(const owner of owners){const s=lstatSync(owner.path,{bigint:true});if(s.dev!==owner.stat.dev||s.ino!==owner.stat.ino||realpathSync(owner.path)!==owner.path)throw new Error('Rejected source owner changed');}};
 const noReceipt=async()=>{try{await lstat(join(dir,'publication.json'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}throw new Error('Accepted or prepared source must be retained');};
 await noReceipt();
 const before=await lstat(source,{bigint:true});if(!before.isFile()||await realpath(source)!==source)throw new Error('Unsafe rejected source');
 const download=JSON.parse(await readFile(join(dir,'download.json'),'utf8'));
 if(download.bytes!==Number(before.size)||await sha256(source)!==download.sha256)throw new Error('Rejected source changed');
 for(const path of options.retainedReceiptPaths){guard();const receipt=receiptSchema.parse(JSON.parse(await readFile(path,'utf8')));if(resolve(receipt.sourcePath)===source)throw new Error('Rejected source is referenced');}
 guard();const manifest={version:1,purpose:'rejected-source-cleanup-only; never publication evidence',state:'verified_before_removal',source,sourceSha256:download.sha256,sourceBytes:Number(before.size),reason:options.reason,observedAt:new Date().toISOString()};
 await durableJson(join(dir,'rejected-source-retention.json'),manifest);await options.beforeRemoval?.();guard();await noReceipt();
 const now=await lstat(source,{bigint:true});for(const field of ['dev','ino','size','mtimeNs','ctimeNs'] as const)if(now[field]!==before[field])throw new Error('Rejected source changed before removal');
 await unlink(source);await syncDirectory(dir);guard();await durableJson(join(dir,'rejected-source-retention.json'),{...manifest,state:'raw_removed',removedAt:new Date().toISOString()});
 return {rawLogicalBytesRemoved:Number(before.size)};
}
