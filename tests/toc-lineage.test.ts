import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateTocLineage } from '../src/lib/tic/toc-lineage';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
test('projected TOC binds complete parent and exact projection; parent cache invalidates on mutation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tic-lineage-'));
 try{
  const parentPath=join(dir,'parent.gz'),receiptPath=join(dir,'receipt.json'),tocPath=join(dir,'projection.gz');
  await writeFile(parentPath,'parent');
  const data=JSON.stringify({parent:{sha256:sha('parent'),compressedBytes:6,validatedJsonEof:true},projections:[{file:'projection.gz',sourceUrl:'https://example.com/rate',parentSha256:sha('parent'),sha256:sha('toc')}]});
  await writeFile(receiptPath,data);
  const lineage={parentPath,receiptPath,parentSha256:sha('parent'),receiptSha256:sha(data)};
  await validateTocLineage(lineage,tocPath,sha('toc'),'https://example.com/rate');
  await assert.rejects(validateTocLineage(lineage,tocPath,sha('wrong'),'https://example.com/rate'),/lineage mismatch/);
  await writeFile(parentPath,'mutate');
  await assert.rejects(validateTocLineage(lineage,tocPath,sha('toc'),'https://example.com/rate'),/parent hash mismatch/);
  await writeFile(receiptPath,'{}');
  await assert.rejects(validateTocLineage(lineage,tocPath,sha('toc'),'https://example.com/rate'),/receipt changed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
