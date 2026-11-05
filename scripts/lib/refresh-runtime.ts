import { statSync, realpathSync, statfsSync,writeFileSync,renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, open, rename, readFile, stat, realpath, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { sourceIdentity } from './issuer-discovery';
import {downloadOwnedFile,type DownloadJournal} from './download-staging';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inspectVolume,EXPECTED_UUID } = require('./refresh-volume-guard.cjs');
export const stateRoot = join(homedir(), 'Library/Application Support/affinity/refresh');
export const archiveRoot = '/Volumes/dev/affinity-data';
export const downloadJournal:DownloadJournal={directory:join(stateRoot,'download-staging'),archiveRoot,volumeUUID:EXPECTED_UUID};
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
/** Deletion-only recovery may reclaim owned partials below the free-space floor.
 * inspectVolume checks UUID, exact mount and writability before that floor. No
 * download or publication receives this guard; normal admission runs afterward. */
export function volumeCleanupSessionGuard(){
 const state=inspectVolume();if(state.state!=='ready'&&state.reason!=='ssd_free_space_floor')throw new Deferred(state.reason);
 const device=statSync(archiveRoot).dev;
 return ()=>{try{if(statSync(archiveRoot).dev!==device||realpathSync(archiveRoot)!==archiveRoot)throw new Error();}catch{throw new Deferred('ssd_disconnected');}};
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
/** Shared by publishers and supervisor checkpoint updates; never changes PID ownership. */
export async function lockRunMutex(directory = stateRoot) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // The OS releases SQLite's write reservation even after SIGKILL/OOM. Never
  // unlink its inode: all contenders must coordinate through the same database.
  const mutexPath=join(directory,'run-mutex.sqlite');
  await (await open(mutexPath,'a',0o600)).close();
  const mutex=new DatabaseSync(mutexPath);
  try { mutex.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); }
  catch(error) { mutex.close(); if((error as Error).message.includes('locked')) throw new Deferred('publisher_already_running'); throw error; }
  let released=false;
  return ()=>{if(released)return;released=true;try{mutex.exec('ROLLBACK');}finally{mutex.close();}};
}
export async function lockRun(directory = stateRoot) {
  const releaseMutex=await lockRunMutex(directory);
  const path = join(directory, 'run.lock');
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
      finally { releaseMutex(); }
    };
  } catch(error) { releaseMutex();throw error; }

}
export function sourceKey(url: string) {
  return createHash('sha256').update(sourceIdentity(url)).digest('hex');
}
export async function downloadFile(url: string, path: string, maxBytes: number, guard: () => void = requireVolume, fetcher = fetch, timeoutMs = 120000) {
 return downloadOwnedFile({url,path,maxBytes,guard,fetcher,timeoutMs,...(resolve(path).startsWith(archiveRoot+'/')?{journal:downloadJournal}:{})});
}
export async function ensureArchiveDirectory(path: string) {
  requireVolume();
  const parent = resolve(path);
  if (!parent.startsWith(archiveRoot + '/')) throw new Error('Archive outside SSD root');
  await mkdir(parent, { recursive: true });
  if (!(await realpath(parent)).startsWith(archiveRoot + '/')) throw new Error('Archive symlink escape');
}
