import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const lineageSchema=z.object({receiptPath:z.string(),receiptSha256:digest,parentPath:z.string(),parentSha256:digest});
const checked=new Map<string,string>();
async function hash(path:string){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
/** Cache only immutable parent bytes within one process; any stat change forces a full hash. */
export async function validateTocLineage(lineage:z.infer<typeof lineageSchema>,tocPath:string,tocSha256:string,sourceUrl:string){
 if(await hash(lineage.receiptPath)!==lineage.receiptSha256)throw new Error('TOC lineage receipt changed');
 const receipt=JSON.parse(await readFile(lineage.receiptPath,'utf8'));
 const parent=receipt.parent;
 if(parent?.sha256!==lineage.parentSha256||parent.validatedJsonEof!==true)throw new Error('TOC parent lacks complete validation');
 const projection=receipt.projections?.find((p:{file:string;sourceUrl:string})=>resolve(dirname(lineage.receiptPath),p.file)===resolve(tocPath)&&p.sourceUrl===sourceUrl);
 if(!projection||projection.sha256!==tocSha256||projection.parentSha256!==lineage.parentSha256)throw new Error('TOC projection lineage mismatch');
 const before=await stat(lineage.parentPath,{bigint:true});
 if(!before.isFile()||before.size!==BigInt(parent.compressedBytes))throw new Error('TOC parent size mismatch');
 const stamp=[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':');
 const key=resolve(lineage.parentPath)+'\n'+lineage.parentSha256;
 if(checked.get(key)!==stamp){
  if(await hash(lineage.parentPath)!==lineage.parentSha256)throw new Error('TOC parent hash mismatch');
  const after=await stat(lineage.parentPath,{bigint:true});
  if([after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(':')!==stamp)throw new Error('TOC parent changed during validation');
  checked.set(key,stamp);
 }
}
