import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync, createDeflateRaw, crc32 } from 'node:zlib';
import { Readable, Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { openZipJson, ZipJsonError } from './zip-json';

type Fixture = { name:string; body?:Buffer; method?:0|8; descriptor?:boolean|'unsigned'; attrs?:number; flags?:number; extra?:Buffer };
function headers(name:Buffer, method:number, flags:number, sum:number, compressed:number, decoded:number, localOffset:number, attrs=0) {
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
  local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);local.writeUInt16LE(name.length,26);
  if(!(flags&8)){local.writeUInt32LE(sum,14);local.writeUInt32LE(compressed,18);local.writeUInt32LE(decoded,22);}
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(sum,16);central.writeUInt32LE(compressed,20);central.writeUInt32LE(decoded,24);
  central.writeUInt16LE(name.length,28);central.writeUInt32LE(attrs>>>0,38);central.writeUInt32LE(localOffset,42);
  return {local,central};
}
function archive(entries:Fixture[],comment=Buffer.alloc(0)) {
  const bodies:Buffer[]=[],directory:Buffer[]=[];let offset=0;
  for(const e of entries){
    const name=Buffer.from(e.name),body=e.body??Buffer.from('{"ok":true}'),method=e.method??8;
    const encoded=method===8?deflateRawSync(body):body,sum=crc32(body),flags=(e.flags??0)|(e.descriptor?8:0),ex=e.extra??Buffer.alloc(0);
    const h=headers(name,method,flags,sum,encoded.length,body.length,offset,e.attrs);
    h.local.writeUInt16LE(ex.length,28);h.central.writeUInt16LE(ex.length,30);
    const descriptor=Buffer.alloc(e.descriptor?(e.descriptor==='unsigned'?12:16):0);
    if(e.descriptor){const start=descriptor.length===16?4:0;if(start)descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(sum,start);descriptor.writeUInt32LE(encoded.length,start+4);descriptor.writeUInt32LE(body.length,start+8);}
    bodies.push(h.local,name,ex,encoded,descriptor);directory.push(h.central,name,ex);
    offset+=h.local.length+name.length+ex.length+encoded.length+descriptor.length;
  }
  const cd=Buffer.concat(directory),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(comment.length,20);
  return Buffer.concat([...bodies,cd,end,comment]);
}
async function work(t:{after:(fn:()=>Promise<void>)=>void},bytes:Buffer){
  const root=await mkdtemp(join(tmpdir(),'affinity-zip-json-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const input=join(root,'source.zip');await writeFile(input,bytes);return{root,input};
}
async function collect(s:Readable){const chunks:Buffer[]=[];for await(const chunk of s)chunks.push(chunk as Buffer);return Buffer.concat(chunks);}
const isCode=(code:string)=>(e:unknown)=>e instanceof ZipJsonError&&e.code===code;
const central=(b:Buffer)=>b.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));

test('streams stored/deflated JSON and signed/unsigned descriptors, preserving source bytes without extraction',async t=>{
  for(const method of [0,8] as const)for(const descriptor of [false,true,'unsigned'] as const){
    const body=Buffer.from('{"providers":[1,2,3],"unicode":"λ"}'),bytes=archive([{name:'folder/',body:Buffer.alloc(0),method:0,attrs:0x10},{name:'folder/data.json',body,method,descriptor}]);
    const f=await work(t,bytes);let guards=0;const stream=await openZipJson(f.input,{guard(){guards++;}});
    let ended=false;stream.on('end',()=>{ended=true;});
    assert.deepEqual(await collect(stream),body);assert.equal(ended,true);
    assert.deepEqual(await stream.verified,{...stream.zip,verified:true});assert.equal(stream.zip.decodedBytes,body.length);assert.equal(stream.zip.crc32,crc32(body));
    assert.ok(guards>5);assert.deepEqual(await readFile(f.input),bytes);assert.deepEqual(await readdir(f.root),['source.zip']);
  }
});

test('EOCD, central/local name/size/flag and descriptor disagreement are rejected before returning a reader',async t=>{
  for(const mutate of [
    (b:Buffer)=>b.subarray(0,-4),
    (b:Buffer)=>{b.writeUInt32LE(999,b.length-6);return b;},
    (b:Buffer)=>{b[30]^=1;return b;},
    (b:Buffer)=>{b.writeUInt16LE(1,6);return b;},
    (b:Buffer)=>{b.writeUInt32LE(999,18);return b;},
    (b:Buffer)=>{b[central(b)-12]^=1;return b;},
  ]){
    // Last mutation targets a descriptor byte; others also work with descriptor headers.
    const bytes=archive([{name:'data.json',descriptor:true}]);const f=await work(t,mutate(bytes));
    await assert.rejects(openZipJson(f.input),e=>e instanceof ZipJsonError);
  }
});

test('unsafe names, symlinks, multiple members, encryption, multipart, ZIP64 and unsupported compression fail closed',async t=>{
  const fixtures=[
    archive([{name:'../data.json'}]),archive([{name:'/data.json'}]),archive([{name:'C:data.json'}]),archive([{name:'folder\\data.json'}]),
    archive([{name:'data.json',attrs:0xa000<<16}]),archive([{name:'a.json'},{name:'b.json'}]),
    archive([{name:'data.txt'}]),archive([{name:'data.json',flags:1}]),archive([{name:'data.json',extra:Buffer.from([1,0,0,0])}]),
  ];
  const multipart=archive([{name:'data.json'}]);multipart.writeUInt16LE(1,multipart.length-18);fixtures.push(multipart);
  const zip64=archive([{name:'data.json'}]);zip64.writeUInt32LE(0xffffffff,zip64.length-6);fixtures.push(zip64);
  const compression=archive([{name:'data.json'}]);compression.writeUInt16LE(9,central(compression)+10);fixtures.push(compression);
  for(const bytes of fixtures){const f=await work(t,bytes);await assert.rejects(openZipJson(f.input),e=>e instanceof ZipJsonError);}
});

test('declared cap and streaming cap are enforced without a successful end event',async t=>{
  const bytes=archive([{name:'data.json',body:Buffer.from('x'.repeat(1024))}]),f=await work(t,bytes);
  await assert.rejects(openZipJson(f.input,{maxDecodedBytes:100}),isCode('limit'));
  bytes.writeUInt32LE(10,22);bytes.writeUInt32LE(10,central(bytes)+24);await writeFile(f.input,bytes);
  const stream=await openZipJson(f.input,{maxDecodedBytes:100});let ended=false;stream.on('end',()=>{ended=true;});
  await assert.rejects(collect(stream),isCode('limit'));await assert.rejects(stream.verified,isCode('limit'));assert.equal(ended,false);
});

test('CRC and decoded length mismatches reach the consumer instead of premature-close cleanup errors',async t=>{
  for(const mode of ['crc','length']){
    const bytes=archive([{name:'data.json'}]),cd=central(bytes);
    if(mode==='crc'){bytes.writeUInt32LE(123,14);bytes.writeUInt32LE(123,cd+16);}
    else{bytes.writeUInt32LE(999,22);bytes.writeUInt32LE(999,cd+24);}
    const f=await work(t,bytes),stream=await openZipJson(f.input);let ended=false;stream.on('end',()=>{ended=true;});
    await assert.rejects(collect(stream),isCode(mode));await assert.rejects(stream.verified,isCode(mode));assert.equal(ended,false);
  }
});

test('truncated or extra raw-deflate bytes cannot pass CRC-only validation',async t=>{
  for(const mode of ['truncated','trailing']){
    const bytes=archive([{name:'data.json',body:Buffer.from('{"payload":"'+'x'.repeat(5000)+'"}')}]);
    const cd=central(bytes),nameLength=bytes.readUInt16LE(26),start=30+nameLength,oldCompressed=bytes.readUInt32LE(18);
    const payload=bytes.subarray(start,start+oldCompressed);
    const replacement=mode==='truncated'?payload.subarray(0,-2):Buffer.concat([payload,Buffer.from('extra')]);
    const delta=replacement.length-oldCompressed;
    const changed=Buffer.concat([bytes.subarray(0,start),replacement,bytes.subarray(cd)]);
    changed.writeUInt32LE(replacement.length,18);changed.writeUInt32LE(replacement.length,cd+delta+20);changed.writeUInt32LE(cd+delta,changed.length-6);
    const f=await work(t,changed),stream=await openZipJson(f.input);
    await assert.rejects(collect(stream),e=>e instanceof ZipJsonError);await assert.rejects(stream.verified,e=>e instanceof ZipJsonError);
  }
});

test('guard failures survive pipeline cleanup, and early close rejects integrity verification',async t=>{
  const f=await work(t,archive([{name:'data.json',body:Buffer.from('x'.repeat(200000))}]));let disconnected=false;
  const sentinel=new Error('Fixture device detached');
  const stream=await openZipJson(f.input,{guard(){if(disconnected)throw sentinel;}});disconnected=true;
  await assert.rejects(collect(stream),e=>e instanceof ZipJsonError&&e.code==='guard'&&(e as Error &{cause?:unknown}).cause===sentinel);
  await assert.rejects(stream.verified,isCode('guard'));
  const early=await openZipJson(f.input);early.destroy();await assert.rejects(early.verified,isCode('incomplete'));
});

test('guard failure immediately before opening the archive retains its guard code and original cause',async t=>{
  const f=await work(t,archive([{name:'data.json'}]));let calls=0;const sentinel=new Error('Fixture open-time disconnect');
  await assert.rejects(openZipJson(f.input,{guard(){if(++calls===2)throw sentinel;}}),
    e=>e instanceof ZipJsonError&&e.code==='guard'&&(e as Error&{cause?:unknown}).cause===sentinel);
});

test('source modification and local-file-only contract are enforced',async t=>{
  await assert.rejects(openZipJson('https://example.invalid/source.zip'),isCode('io'));
  const f=await work(t,archive([{name:'data.json',body:Buffer.from('{"ok":true}')}])),stream=await openZipJson(f.input);
  await assert.rejects(openZipJson(f.root),isCode('io'));
  await writeFile(f.input,Buffer.concat([await readFile(f.input),Buffer.from([0])]));
  await assert.rejects(collect(stream),isCode('changed'));await assert.rejects(stream.verified,isCode('changed'));
});

test('192 MiB member streams under a 32 MiB old-space ceiling without an extracted file', {timeout:120_000},async t=>{
  const f=await work(t,Buffer.alloc(0)),name=Buffer.from('large.json'),initial=headers(name,8,8,0,0,0,0);
  await writeFile(f.input,Buffer.concat([initial.local,name]));
  let decoded=0,compressed=0,sum=0;
  async function* content(){yield Buffer.from('{"data":"');for(let i=0;i<768;i++)yield Buffer.alloc(262144,0x78);yield Buffer.from('"}');}
  const meter=new Transform({transform(chunk:Buffer,_,done){decoded+=chunk.length;sum=crc32(chunk,sum);done(null,chunk);}});
  const size=new Transform({transform(chunk:Buffer,_,done){compressed+=chunk.length;done(null,chunk);}});
  await pipeline(Readable.from(content()),meter,createDeflateRaw(),size,createWriteStream(f.input,{flags:'a'}));
  const h=headers(name,8,8,sum,compressed,decoded,0),descriptor=Buffer.alloc(16),end=Buffer.alloc(22);
  descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(sum,4);descriptor.writeUInt32LE(compressed,8);descriptor.writeUInt32LE(decoded,12);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(h.central.length+name.length,12);end.writeUInt32LE(initial.local.length+name.length+compressed+16,16);
  await writeFile(f.input,Buffer.concat([descriptor,h.central,name,end]),{flag:'a'});
  const module=fileURLToPath(new URL('./zip-json.ts',import.meta.url));
  const code='import{openZipJson}from '+JSON.stringify(module)+';const s=await openZipJson(process.argv[1]);let n=0;for await(const b of s)n+=b.length;const v=await s.verified;console.log(JSON.stringify({n,v,rss:process.resourceUsage().maxRSS/1024}));';
  const child=spawn(process.execPath,['--max-old-space-size=32','--import','tsx','--input-type=module','-e',code,f.input],{cwd:dirname(module),stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(90_000)});
  t.after(()=>{if(child.exitCode===null)child.kill();});let stdout='',stderr='';
  child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  const exit=await new Promise<number|null>((yes,no)=>{child.on('error',no);child.on('close',yes);});
  assert.equal(exit,0,stderr);const result=JSON.parse(stdout);
  assert.equal(result.n,decoded);assert.equal(result.v.verified,true);assert.equal(result.v.crc32,sum);assert.ok(result.rss<192);
  assert.deepEqual(await readdir(f.root),['source.zip']);
  t.diagnostic(JSON.stringify({decoded,compressed,oldSpaceMiB:32,peakRssMiB:result.rss}));
});
