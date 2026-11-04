/** Local ZIP32 member streaming only: no network, extraction paths, or output files. */
import { constants } from 'node:fs';
import { open, lstat, type FileHandle } from 'node:fs/promises';
import { Readable, Transform, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 } from 'node:zlib';

export interface ZipJsonOptions { maxDecodedBytes?: number; guard?: () => void }
export interface ZipJsonMetadata {
  memberName: string; method: 0 | 8; compressedBytes: number; decodedBytes: number; crc32: number;
}
export interface ZipJsonVerification extends ZipJsonMetadata { verified: true }
export interface ZipJsonReadable extends Readable {
  readonly zip: Readonly<ZipJsonMetadata>;
  /** Resolves only after full consumption, CRC/length validation and source stability checks. */
  readonly verified: Promise<ZipJsonVerification>;
}
export class ZipJsonError extends Error {
  constructor(public readonly code: 'format' | 'unsupported' | 'limit' | 'crc' | 'length' | 'inflate' | 'guard' | 'changed' | 'incomplete' | 'io', message: string, cause?: unknown) {
    super(message); this.name = 'ZipJsonError';
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause });
  }
}
function fail(code: ZipJsonError['code'], message: string): never { throw new ZipJsonError(code, message); }
type Entry = ZipJsonMetadata & { name: Buffer; flags: number; local: number; dataStart: number; directory: boolean };
const MAX_DECODED = 5_000_000_000, MAX_DIRECTORY = 1_000_000, MAX_ENTRIES = 128, MAX_NAME = 4096;
function extra(bytes: Buffer) {
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) fail('format', 'Truncated ZIP extra field');
    const id = bytes.readUInt16LE(offset), n = bytes.readUInt16LE(offset + 2); offset += 4;
    if (id === 1) fail('unsupported', 'ZIP64 is not supported');
    if (offset + n > bytes.length) fail('format', 'Invalid ZIP extra field length');
    offset += n;
  }
}
function name(bytes: Buffer, flags: number) {
  let result: string;
  if (flags & 0x800) {
    try { result = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return fail('format', 'Invalid UTF-8 ZIP member name'); }
  } else {
    if (bytes.some(byte => byte > 0x7f)) fail('unsupported', 'Legacy non-ASCII ZIP member names require a reviewed adapter');
    result = bytes.toString('ascii');
  }
  const parts = result.replace(/\/$/, '').split('/');
  if (!result || result.startsWith('/') || result.includes('\\') || result.includes(':') ||
      /[\x00-\x1f\x7f]/.test(result) || parts.some(p => !p || p === '.' || p === '..')) fail('format', 'Unsafe ZIP member name');
  return result;
}

export async function openZipJson(input: string, options: ZipJsonOptions = {}): Promise<ZipJsonReadable> {
  const maxDecoded = options.maxDecodedBytes ?? MAX_DECODED;
  if (!Number.isSafeInteger(maxDecoded) || maxDecoded <= 0 || maxDecoded > MAX_DECODED) fail('limit', 'Decoded ZIP cap must be a positive integer at most 5 GB');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) fail('io', 'ZIP reader accepts local files only');
  const guard = () => { try { options.guard?.(); } catch (error) { throw new ZipJsonError('guard', 'ZIP storage identity guard failed', error); } };
  guard();
  let handle: FileHandle;
  try {
    const named = await lstat(input);
    if (!named.isFile() || named.isSymbolicLink()) fail('io', 'ZIP reader requires a regular local archive');
    guard(); handle = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  }
  catch (error) { throw error instanceof ZipJsonError ? error : new ZipJsonError('io', 'Cannot open local ZIP archive', error); }
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.size < BigInt(22) || initial.size > BigInt(0xffffffff) + BigInt(65_557)) fail('format', 'Archive is not a bounded regular ZIP32 file');
    const size = Number(initial.size);
    async function read(position: number, length: number) {
      if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > size) fail('format', 'ZIP metadata lies outside archive bounds');
      const b = Buffer.alloc(length); let offset = 0;
      while (offset < length) {
        guard(); const r = await handle.read(b, offset, length - offset, position + offset);
        if (!r.bytesRead) fail('format', 'Truncated ZIP metadata');
        offset += r.bytesRead;
      }
      guard(); return b;
    }
    const tailLength = Math.min(size, 65_557), tail = await read(size - tailLength, tailLength);
    let end = -1;
    for (let p = tail.length - 22; p >= 0; p--) {
      if (tail.readUInt32LE(p) === 0x06054b50 && p + 22 + tail.readUInt16LE(p + 20) === tail.length) { end = p; break; }
    }
    if (end < 0) fail('format', 'ZIP end-of-central-directory is absent or truncated');
    if (end >= 20 && tail.readUInt32LE(end - 20) === 0x07064b50) fail('unsupported', 'ZIP64 locator is not supported');
    const count = tail.readUInt16LE(end + 10), cdBytes = tail.readUInt32LE(end + 12), cdStart = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count) fail('unsupported', 'Multipart ZIP archives are not supported');
    if (count === 0xffff || cdBytes === 0xffffffff || cdStart === 0xffffffff) fail('unsupported', 'ZIP64 is not supported');
    if (!count || count > MAX_ENTRIES || cdBytes > MAX_DIRECTORY) fail('limit', 'ZIP directory metadata exceeds its cap');
    if (cdStart + cdBytes !== size - tailLength + end) fail('format', 'ZIP directory bounds are inconsistent');
    const directory = await read(cdStart, cdBytes), entries: Entry[] = [], seen = new Set<string>(); let offset = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) fail('format', 'Invalid ZIP central entry');
      const flags = directory.readUInt16LE(offset + 8), method = directory.readUInt16LE(offset + 10);
      const sum = directory.readUInt32LE(offset + 16), compressedBytes = directory.readUInt32LE(offset + 20), decodedBytes = directory.readUInt32LE(offset + 24);
      const n = directory.readUInt16LE(offset + 28), ex = directory.readUInt16LE(offset + 30), comment = directory.readUInt16LE(offset + 32);
      const local = directory.readUInt32LE(offset + 42), attrs = directory.readUInt32LE(offset + 38), mode = attrs >>> 16 & 0xf000;
      if (flags & ~0x80e || (method !== 0 && method !== 8) || directory.readUInt16LE(offset + 6) > 20) fail('unsupported', 'Unsupported ZIP compression, encryption, flags or required version');
      if (method === 0 && flags & 6) fail('unsupported', 'Invalid stored-member compression flags');
      if (directory.readUInt16LE(offset + 34)) fail('unsupported', 'Multipart ZIP member is not supported');
      if ([compressedBytes, decodedBytes, local].includes(0xffffffff)) fail('unsupported', 'ZIP64 member is not supported');
      if (!n || n > MAX_NAME || offset + 46 + n + ex + comment > directory.length) fail('format', 'Invalid ZIP member metadata length');
      const rawName = directory.subarray(offset + 46, offset + 46 + n), memberName = name(rawName, flags), isDirectory = memberName.endsWith('/');
      if (seen.has(memberName.toLowerCase())) fail('format', 'Duplicate ZIP member names');
      seen.add(memberName.toLowerCase());
      if (mode === 0xa000 || (mode && mode !== 0x8000 && mode !== 0x4000)) fail('unsupported', 'ZIP symlinks or special files are not supported');
      if ((mode === 0x4000 || Boolean(attrs & 0x10)) && !isDirectory) fail('format', 'ZIP directory attributes disagree with its name');
      if (isDirectory && mode === 0x8000) fail('format', 'ZIP directory name has regular-file attributes');
      if (isDirectory && (compressedBytes || decodedBytes || sum || method !== 0)) fail('format', 'Directory entries cannot contain payloads');
      extra(directory.subarray(offset + 46 + n, offset + 46 + n + ex));
      entries.push({ memberName, method: method as 0 | 8, compressedBytes, decodedBytes, crc32: sum, name: Buffer.from(rawName), flags, local, dataStart: 0, directory: isDirectory });
      offset += 46 + n + ex + comment;
    }
    if (offset !== directory.length) fail('format', 'Unexpected bytes in ZIP central directory');
    const dataEntries = entries.filter(e => !e.directory);
    if (dataEntries.length !== 1 || !/\.json$/i.test(dataEntries[0].memberName)) fail('format', 'ZIP must contain exactly one JSON data member');
    const selected = dataEntries[0];
    if (selected.decodedBytes > maxDecoded) fail('limit', 'Declared ZIP member exceeds decoded-byte cap');
    if (selected.method === 0 && selected.compressedBytes !== selected.decodedBytes) fail('length', 'Stored ZIP member sizes differ');
    const ordered = [...entries].sort((a,b) => a.local - b.local); let cursor = 0;
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i], next = ordered[i + 1]?.local ?? cdStart;
      if (e.local !== cursor || e.local + 30 > cdStart) fail('format', 'ZIP local entries have gaps, overlap or a prepended payload');
      const local = await read(e.local, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(4) > 20 ||
          local.readUInt16LE(6) !== e.flags || local.readUInt16LE(8) !== e.method) fail('format', 'ZIP central and local headers disagree');
      const n = local.readUInt16LE(26), ex = local.readUInt16LE(28);
      if (n !== e.name.length || e.local + 30 + n + ex > cdStart) fail('format', 'ZIP local member name or extra field exceeds bounds');
      const fields = await read(e.local + 30, n + ex);
      if (!fields.subarray(0,n).equals(e.name)) fail('format', 'ZIP central and local member names disagree');
      extra(fields.subarray(n));
      for (const [pos, expected] of [[14,e.crc32],[18,e.compressedBytes],[22,e.decodedBytes]]) {
        const actual = local.readUInt32LE(pos);
        if (actual !== expected && (!(e.flags & 8) || actual !== 0)) fail('format', 'ZIP central and local CRC or sizes disagree');
      }
      e.dataStart = e.local + 30 + n + ex;
      const dataEnd = e.dataStart + e.compressedBytes;
      if (dataEnd > next) fail('format', 'ZIP member payload overlaps metadata or another member');
      const descriptorLength = next - dataEnd;
      if (e.flags & 8) {
        if (![12,16].includes(descriptorLength)) fail('format', 'Invalid ZIP32 data-descriptor size');
        const descriptor = await read(dataEnd, descriptorLength), start = descriptorLength === 16 ? 4 : 0;
        if ((start && descriptor.readUInt32LE(0) !== 0x08074b50) || descriptor.readUInt32LE(start) !== e.crc32 ||
            descriptor.readUInt32LE(start + 4) !== e.compressedBytes || descriptor.readUInt32LE(start + 8) !== e.decodedBytes) fail('format', 'ZIP data descriptor disagrees with central directory');
      } else if (descriptorLength) fail('format', 'Unexpected bytes after ZIP member payload');
      cursor = next;
    }
    const metadata = Object.freeze({
      memberName: selected.memberName, method: selected.method, compressedBytes: selected.compressedBytes,
      decodedBytes: selected.decodedBytes, crc32: selected.crc32,
    });
    let resolveVerified!: (value: ZipJsonVerification) => void, rejectVerified!: (error: unknown) => void, settled = false;
    const verified = new Promise<ZipJsonVerification>((yes,no) => { resolveVerified=yes;rejectVerified=no; });
    void verified.catch(() => {}); // Optional property must not cause unhandled-rejection noise.
    const reject = (error: unknown) => { if (!settled) { settled=true;rejectVerified(error); } };
    async function* decode() {
      let firstError: unknown, compressedCount = 0, decodedCount = 0, checksum = 0;
      const remember = (error: unknown) => { if (!firstError || (!(firstError instanceof ZipJsonError) && error instanceof ZipJsonError)) firstError=error; };
      const raw = selected.compressedBytes ? handle.createReadStream({
        start: selected.dataStart, end: selected.dataStart + selected.compressedBytes - 1, autoClose: false, highWaterMark: 65_536,
      }) : Readable.from([]);
      const count = new Transform({ transform(chunk: Buffer, _, done) {
        try { guard(); compressedCount+=chunk.length; done(null,chunk); }
        catch(error){remember(error);done(error as Error);}
      } });
      const output = selected.method === 8 ? createInflateRaw() : new PassThrough();
      const work = pipeline(raw,count,output).catch(error=>{remember(error);throw error;});
      void work.catch(()=>{});
      try {
        for await (const data of output) {
          guard();const chunk=data as Buffer;decodedCount+=chunk.length;
          if(decodedCount>maxDecoded)fail('limit','Decoded ZIP member exceeds byte cap');
          if(decodedCount>selected.decodedBytes)fail('length','Decoded ZIP member exceeds declared length');
          checksum=crc32(chunk,checksum);yield chunk;
        }
        await work;
        if(compressedCount!==selected.compressedBytes || (selected.method===8 && 'bytesWritten' in output && output.bytesWritten!==selected.compressedBytes))fail('length','Compressed ZIP payload was truncated or contains trailing data');
        if(decodedCount!==selected.decodedBytes)fail('length','ZIP uncompressed length mismatch');
        if(checksum!==selected.crc32)fail('crc','ZIP member CRC32 mismatch');
        guard();
        const after=await handle.stat({bigint:true}),named=await lstat(input,{bigint:true});
        if([after,named].some(s=>s.dev!==initial.dev||s.ino!==initial.ino||s.size!==initial.size||s.mtimeNs!==initial.mtimeNs||s.ctimeNs!==initial.ctimeNs))fail('changed','ZIP source changed during streaming');
        await handle.close();settled=true;resolveVerified({...metadata,verified:true});
      } catch(error) {
        remember(error);
        const safe=firstError instanceof ZipJsonError?firstError:new ZipJsonError('inflate','ZIP payload stream failed',firstError);
        reject(safe);throw safe;
      } finally {
        raw.destroy();count.destroy();output.destroy();await work.catch(()=>{});
        await handle.close().catch(()=>{});
        if(!settled)reject(new ZipJsonError('incomplete','ZIP stream closed before integrity verification'));
      }
    }
    const stream=Readable.from(decode(),{objectMode:false}) as ZipJsonReadable;
    Object.defineProperties(stream,{zip:{value:metadata},verified:{value:verified}});
    stream.once('close',()=>{
      if(!settled)reject(new ZipJsonError('incomplete','ZIP stream closed before integrity verification'));
      void handle.close().catch(()=>{});
    });
    return stream;
  } catch(error) {
    await handle.close().catch(()=>{});
    throw error instanceof ZipJsonError?error:new ZipJsonError('io','Cannot validate local ZIP metadata',error);
  }
}
