import {existsSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,writeFile,rm,readdir,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {encodeBucket,decodeBucket,bucketContains,digest,compactReservation} from '../src/lib/tic/compact-codec';
import {buildCompactArchive,validateCompactArchive,compactBuckets,NpiSetHash} from '../src/lib/tic/compact-archive';
import {publicationDigest} from '../src/lib/tic/source-proof';
import {createRequire} from 'node:module';
const {allowed}=createRequire(import.meta.url)('../scripts/ensure-compact-tic-schema.cjs');
test('exact bucket membership, boundaries and corrupted data fail closed',()=>{
 const b=encodeBucket('1234',[0,1,19,999999]);
 for(const n of ['1234000000','1234000001','1234000019','1234999999'])assert.equal(bucketContains(b,n),true);
 for(const n of ['1234000002','1235000000','1234'])assert.equal(bucketContains(b,n),false);
 assert.throws(()=>encodeBucket('1234',[1,1]));assert.throws(()=>encodeBucket('1234',[2,1]));
 const payload=Buffer.from(b.payload);payload[0]^=1;assert.throws(()=>decodeBucket({...b,payload}));
 assert.throws(()=>decodeBucket({...b,count:1}));assert.throws(()=>decodeBucket({...b,rawSha256:'0'.repeat(64)}));
 assert.throws(()=>compactReservation(33_000_000,1,1));
});
test('complete normalized NPI set is preserved across prefixes and TIN duplicates',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'tic-compact-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 async function* rows(){for(const npi of ['0000000001','1234000001','1234000001','9999999999'])yield {npi};}
 const receipt=await buildCompactArchive(dir,'a'.repeat(64),rows());
 const set=new NpiSetHash();for await(const r of rows())set.add(r.npi);
 const source={membershipSha256:'a'.repeat(64),membershipCount:4,npiCount:set.count,npiSha256:set.finish()};
 await validateCompactArchive(receipt,source);assert.equal(receipt.npiCount,3);assert.equal(receipt.bucketCount,3);
 await assert.rejects(validateCompactArchive(receipt,{...source,membershipCount:3}));
 await assert.rejects(validateCompactArchive(receipt,{...source,npiSha256:'b'.repeat(64)}));
 const buckets=[];for await(const b of compactBuckets(receipt))buckets.push(b);assert.equal(buckets.length,3);
 const path=join(dirname(receipt.manifestPath),'1234.deflate');const raw=await readFile(path);raw[0]^=1;await writeFile(path,raw);
 await assert.rejects(validateCompactArchive(receipt,source));
});
test('derived serving receipt cannot alter authenticated original source fields',()=>{
 const source={version:1,sourceSha256:digest('raw'),membershipSha256:digest('rows')};
 assert.equal(publicationDigest(source),publicationDigest({...source,serving:{manifestSha256:digest('derived')}}));
 assert.notEqual(publicationDigest(source),publicationDigest({...source,membershipSha256:digest('other')}));
});
test('schema startup is scoped to the known service or disposable loopback database',()=>{
 assert.equal(allowed({}),false);
 assert.equal(allowed({DATABASE_URL:'postgresql://user@127.0.0.1:55439/affinity_employer_e2e',AFFINITY_COMPACT_SCHEMA_LOCAL:'1'}),true);
 assert.throws(()=>allowed({DATABASE_URL:'postgresql://user@remote/affinity_employer_e2e',AFFINITY_COMPACT_SCHEMA_LOCAL:'1'}));
 assert.throws(()=>allowed({DATABASE_URL:'postgresql://user@remote/other',RENDER:'true',RENDER_SERVICE_ID:'other'}));
});

test('completed compact directory recovers the receipt gap and refuses changed source bytes',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'tic-compact-recovery-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 async function* source(){yield {npi:'1234000001'};yield {npi:'1234000002'};}
 const first=await buildCompactArchive(dir,'a'.repeat(64),source());
 assert.deepEqual(await buildCompactArchive(dir,'a'.repeat(64),source()),first);
 await assert.rejects(buildCompactArchive(dir,'b'.repeat(64),source()),/differs/);
 async function* changed(){yield {npi:'1234000003'};}
 await assert.rejects(buildCompactArchive(dir,'a'.repeat(64),changed()),/differs/);
});
test('interrupted compact construction preserves the source directory and retries safely',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'tic-compact-stop-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'source-evidence'),'preserve');
 async function* interrupted(){yield {npi:'1234000001'};yield {npi:'2345000001'};throw new Error('interrupted');}
 await assert.rejects(buildCompactArchive(dir,'a'.repeat(64),interrupted()),/interrupted/);
 assert.deepEqual((await readdir(dir)).sort(),['source-evidence']);
 async function* complete(){yield {npi:'1234000001'};}
 await buildCompactArchive(dir,'a'.repeat(64),complete());assert.equal(await readFile(join(dir,'source-evidence'),'utf8'),'preserve');
});
test('a replacement source directory cannot receive compact writes or cleanup',async t=>{
 const parent=await realpath(await mkdtemp(join(tmpdir(),'tic-compact-replaced-')));t.after(()=>rm(parent,{recursive:true,force:true}));const dir=join(parent,'source');await mkdir(dir);
 async function* replaced(){yield {npi:'1234000001'};await rename(dir,dir+'-original');await mkdir(dir);await writeFile(join(dir,'unrelated'),'preserve');yield {npi:'2345000001'};}
 await assert.rejects(buildCompactArchive(dir,'a'.repeat(64),replaced()),/directory changed/);
 assert.equal(await readFile(join(dir,'unrelated'),'utf8'),'preserve');assert.deepEqual(await readdir(dir),['unrelated']);
});

test('disconnect after atomic directory install leaves a recoverable complete archive',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'tic-compact-installed-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 async function* source(){yield {npi:'1234000001'};}
 let interrupt=true;
 await assert.rejects(buildCompactArchive(dir,'a'.repeat(64),source(),()=>{if(interrupt&&existsSync(join(dir,'npi-prefix-v1'))){interrupt=false;throw new Error('simulated disconnect');}}),/simulated disconnect/);
 const recovered=await buildCompactArchive(dir,'a'.repeat(64),source());assert.equal(recovered.npiCount,1);
});
