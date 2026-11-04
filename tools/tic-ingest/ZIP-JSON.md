# Local ZIP32 JSON stream

`lib/zip-json.ts` exports:

```ts
const stream = await openZipJson(localArchivePath, {
  maxDecodedBytes: 5_000_000_000, // default and maximum; may be lowered
  guard: synchronousDeviceGuard,
});
await pipeline(stream, existingJsonConsumer);
const verification = await stream.verified;
```

The result **is a Node Readable** for the existing decoded-input interface. Readonly `stream.zip` contains `{memberName, method, compressedBytes, decodedBytes, crc32}` from validated container headers. `stream.verified` resolves to that metadata plus `verified:true` only after complete consumption, decoded-length/CRC checks and unchanged source identity/size/timestamps. Successful readable EOF is withheld until those checks pass. Early destruction rejects verification as `incomplete`. Discarded readers must be destroyed so their input descriptor closes.

This reader accepts one regular local archive, streams stored or raw-deflated data (ZIP methods 0/8), and never creates an extraction file or performs network I/O. It checks EOCD, central/local header names/flags/CRC/sizes, bounds and optional signed/unsigned ZIP32 data descriptors. Safe empty directory records are allowed; exactly one data member must have a JSON suffix.

ZIP64, multipart/encryption, unsafe or duplicate names, symlinks/special files, multiple data members, unsupported encodings/compression, arbitrary gaps/preambles and inconsistent headers are rejected. Directory metadata is capped at 1 MB/128 entries and names at 4 KiB. Legacy non-ASCII names without the UTF-8 flag require review. The decoded stream cap is 5 GB, while valid ZIP32 header sizes remain constrained by that format's own 32-bit limits.

Native incremental CRC32 keeps payload memory bounded. `ZipJsonError.code` distinguishes format, unsupported, limit, CRC, length, inflate, guard, source-change, incomplete and I/O errors. A device-guard failure retains its original cause, and a semantic validation error is preserved over secondary stream-cleanup errors. Forward reader errors through any wrapper.

This is container/member integrity, not a JSON/schema, source-date or coverage validator. The existing consumer must still validate JSON EOF and rate-file semantics. The publisher continues hashing and archiving the **original ZIP**, rather than a substituted extracted file.

Verification on Node 24.22.1:

```sh
node --import tsx --test lib/zip-json.test.ts
```

All **10 fixture tests**, standalone typecheck and root-import typecheck passed. Cases cover methods 0/8, 12/16-byte data descriptors, header disagreement, malformed/truncated payloads, CRC/length failures, decoded caps, unsupported formats/names, guard disconnects, source modification and early closure.

A synthetic **201,326,603-byte decoded JSON member** streamed under `--max-old-space-size=32` with **103.42 MiB peak RSS**; the only filesystem artifact was its 195,704-byte compressed member inside the fixture ZIP. That demonstrates memory behavior, not real PHCS throughput or acceptance. No real PHCS source was downloaded or processed on Air. Mini owns import/sniffing integration, full-archive hashes, first real-source acceptance and publication.
