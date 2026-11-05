import {constants} from 'node:fs';
import {copyFile,lstat,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {sha256} from '../../src/lib/tic/publication';
import {sourceIdentity} from './issuer-discovery';
export type SourceArchive={sourceUrl:string;path:string;bytes:number;sha256:string;etag:string|null;lastModified:string|null};
/** Reuse verified source bytes, not unverified extracted output. Keep the original intact. */
export async function reuseSourceArchive(entry:SourceArchive|undefined,args:{sourceUrl:string;etag:string|null;destination:string;root:string;maxBytes:number;guard:()=>void}):Promise<SourceArchive|undefined>{
 if(!entry||!args.etag||entry.etag!==args.etag||sourceIdentity(entry.sourceUrl)!==sourceIdentity(args.sourceUrl))return;
 if(!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||entry.bytes>args.maxBytes)return;
 const root=resolve(args.root)+'/',source=resolve(entry.path),destination=resolve(args.destination);
 if(!source.startsWith(root)||!destination.startsWith(root)||source===destination)throw new Error('Unsafe source archive path');
 args.guard();let before;
 try{before=await lstat(source,{bigint:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
 if(!before.isFile()||await realpath(source)!==source||await realpath(dirname(destination))!==dirname(destination))throw new Error('Unsafe source archive');
 if(Number(before.size)!==entry.bytes||await sha256(source)!==entry.sha256)throw new Error('Source archive hash mismatch');
 args.guard();
 // APFS clones avoid allocating another raw archive. Other filesystems can copy
 // within the already reserved full input budget. Neither path mutates the source.
 try{await copyFile(source,destination,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE_FORCE);}
 catch(e){if(!['ENOTSUP','EOPNOTSUPP','ENOSYS','EXDEV'].includes((e as NodeJS.ErrnoException).code??''))throw e;args.guard();await copyFile(source,destination,constants.COPYFILE_EXCL);}
 args.guard();
 const after=await lstat(source,{bigint:true});
 if([before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':')!==[after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(':')||await sha256(destination)!==entry.sha256)throw new Error('Source archive changed during reuse');
 args.guard();await writeFile(join(dirname(destination),'MANIFEST.md'),`# Verified source archive reuse\n\nTask: avoid repeated source downloads while keeping full validation and the original archive.\n\n| Source | Destination |\n|---|---|\n| ${source} | ${destination} |\n\nOriginal not moved or deleted. Canonical paths, exact source identity, current ETag, size and SHA-256 verified before reuse; destination hash and original stat verified afterward. SHA-256: ${entry.sha256}. Full extraction, TOC mapping and publication validation remain required. No location ambiguity. Next action: extract the complete source within existing limits.\n`,{flag:'wx',mode:0o600});
 return {...entry,path:destination};
}
