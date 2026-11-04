import { statSync, realpathSync, statfsSync,writeFileSync,renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, open, rename, readFile, stat, realpath, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { sourceIdentity } from './issuer-discovery';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inspectVolume } = require('./refresh-volume-guard.cjs');
export const stateRoot = join(homedir(), 'Library/Application Support/affinity/refresh');
export const archiveRoot = '/Volumes/dev/affinity-data';
export class Deferred extends Error {}
export function requireVolume() {
  const state = inspectVolume();
  if (state.state !== 'ready') throw new Deferred(state.reason);
}
export function volumeSessionGuard() {
  requireVolume();
  const device = statSync(archiveRoot).dev;
  return () => {
    try {
      const space=statfsSync(archiveRoot);
      if(space.bavail*space.bsize<150e9)throw new Deferred('ssd_free_space_floor');
      if (statSync(archiveRoot).dev !== device || realpathSync(archiveRoot) !== archiveRoot) throw new Error();
    } catch(e) { if(e instanceof Deferred)throw e; throw new Deferred('ssd_disconnected'); }
  };
}
export function progressJson(path:string,value:unknown){
 const temp=path+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(value)+'\n',{mode:0o600});renameSync(temp,path);
}
export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${process.pid}.tmp`;
  const f = await open(temp, 'wx', 0o600);
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
  await rename(temp, path);
}
export async function storageBudget(extra = 0) {
  requireVolume();
  const space=statfsSync(archiveRoot);
  if(space.bavail*space.bsize-extra<150e9)throw new Deferred('ssd_free_space_reservation');
  const bytes = Number(execFileSync('/usr/bin/du', ['-sk', archiveRoot], { encoding: 'utf8', timeout: 60000 }).split(/\s/)[0]) * 1024;
  if (!Number.isFinite(bytes) || bytes + extra > 100e9) throw new Deferred('ssd_task_budget');
}
export async function credential() {
  const path = join(stateRoot, 'database.json');
  const s = await stat(path);
  if (!s.isFile() || (s.mode & 0o077) || s.uid !== process.getuid?.() || await realpath(path) !== path) throw new Error('Unsafe credential permissions');
  const { url } = JSON.parse(await readFile(path, 'utf8'));
  const u = new URL(url);
  if (u.hostname !== 'dpg-d93fiqpkh4rs73d75cjg-a.ohio-postgres.render.com' || u.pathname !== '/affinity_db_grhk' || u.username !== 'affinity_refresh' || u.searchParams.get('sslmode') !== 'require') throw new Error('Credential destination mismatch');
  return url as string;
}
export async function lockRun(directory = stateRoot) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'run.lock');
  // The OS releases SQLite's write reservation even after SIGKILL/OOM. Never
  // unlink its inode: all contenders must coordinate through the same database.
  const mutexPath=join(directory,'run-mutex.sqlite');
  await (await open(mutexPath,'a',0o600)).close();
  const mutex=new DatabaseSync(mutexPath);
  try { mutex.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); }
  catch(error) { mutex.close(); if((error as Error).message.includes('locked')) throw new Deferred('publisher_already_running'); throw error; }
  try {
    // Honor a still-running publisher from the older PID-lock runtime as well.
    let previous:string|undefined;
    try { previous=await readFile(path,'utf8'); } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    if(previous!==undefined){
      const pid=Number(previous);
      if(!Number.isSafeInteger(pid)||pid<=0)throw new Deferred('publisher_lock_unknown');
      try { process.kill(pid,0);throw new Deferred('publisher_already_running'); }
      catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    }
    const owner=String(process.pid);
    await (await open(path,'w',0o600)).close();
    const file=await open(path,'r+');try{await file.writeFile(owner);await file.sync();}finally{await file.close();}
    let released=false;
    return async()=>{
      if(released)return;released=true;
      try { if(await readFile(path,'utf8')===owner)await unlink(path); }
      finally { mutex.exec('ROLLBACK');mutex.close(); }
    };
  } catch(error) { mutex.exec('ROLLBACK');mutex.close();throw error; }

}
export function sourceKey(url: string) {
  return createHash('sha256').update(sourceIdentity(url)).digest('hex');
}
export async function downloadFile(url: string, path: string, maxBytes: number, guard: () => void = requireVolume, fetcher = fetch, timeoutMs = 120000) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('HTTPS source required');
  guard();
  const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { 'Accept-Encoding': 'identity' } });
  if (!response.ok || !response.body) throw new Error(`Source HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw new Error('source_size_limit'); }
  const partial = path + '.partial';
  guard();
  const f = await open(partial, 'w', 0o600);
  let bytes = 0;
  const hash = createHash('sha256');
  try {
    const reader = response.body.getReader();
    try { while (true) {
      const next = await reader.read(); if (next.done) break;
      const chunk = next.value;
      guard();
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('source_size_limit');
      await f.writeFile(chunk); hash.update(chunk);
    } } finally { await reader.cancel(); reader.releaseLock(); }
    if (!bytes) throw new Error('empty_source');
    const expected = Number(response.headers.get('content-length'));
    if (expected && !response.headers.get('content-encoding') && bytes !== expected) throw new Error('source_length_mismatch');
    await f.sync();
  } finally { await f.close(); }
  guard();
  await rename(partial, path);
  return { bytes, sha256: hash.digest('hex'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
}
export async function ensureArchiveDirectory(path: string) {
  requireVolume();
  const parent = resolve(path);
  if (!parent.startsWith(archiveRoot + '/')) throw new Error('Archive outside SSD root');
  await mkdir(parent, { recursive: true });
  if (!(await realpath(parent)).startsWith(archiveRoot + '/')) throw new Error('Archive symlink escape');
}
