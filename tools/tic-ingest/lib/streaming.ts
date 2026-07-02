import { createReadStream } from "node:fs";
import { Readable, PassThrough } from "node:stream";
import { createGunzip } from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parser } = require("stream-json");

export type JsonToken = {
  name: string;
  value?: unknown;
};

type Frame = {
  type: "object" | "array";
  path: string[];
  currentKey?: string;
};

export class JsonPathTracker {
  private frames: Frame[] = [];

  pathForStart(): string[] {
    const parent = this.frames[this.frames.length - 1];
    if (!parent) return [];
    if (parent.type === "object") return [...parent.path, parent.currentKey ?? ""];
    return [...parent.path, "*"];
  }

  start(type: "object" | "array"): string[] {
    const path = this.pathForStart();
    const parent = this.frames[this.frames.length - 1];
    if (parent?.type === "object") parent.currentKey = undefined;
    this.frames.push({ type, path });
    return path;
  }

  end(): void {
    this.frames.pop();
  }

  key(value: unknown): void {
    const parent = this.frames[this.frames.length - 1];
    if (parent?.type === "object") parent.currentKey = String(value);
  }

  pathForValue(): string[] {
    const parent = this.frames[this.frames.length - 1];
    if (!parent) return [];
    if (parent.type === "object") return [...parent.path, parent.currentKey ?? ""];
    return [...parent.path, "*"];
  }

  value(): string[] {
    const path = this.pathForValue();
    const parent = this.frames[this.frames.length - 1];
    if (parent?.type === "object") parent.currentKey = undefined;
    return path;
  }
}

type CollectorFrame = {
  type: "object" | "array";
  value: Record<string, unknown> | unknown[];
  key?: string;
};

export class JsonValueCollector {
  private frames: CollectorFrame[] = [];
  value: unknown;
  done = false;

  push(token: JsonToken): void {
    if (this.done) return;

    switch (token.name) {
      case "startObject": {
        const value: Record<string, unknown> = {};
        this.attach(value);
        this.frames.push({ type: "object", value });
        break;
      }
      case "startArray": {
        const value: unknown[] = [];
        this.attach(value);
        this.frames.push({ type: "array", value });
        break;
      }
      case "keyValue": {
        const parent = this.frames[this.frames.length - 1];
        if (parent?.type === "object") parent.key = String(token.value);
        break;
      }
      case "stringValue":
      case "numberValue":
        this.attach(String(token.value));
        break;
      case "trueValue":
        this.attach(true);
        break;
      case "falseValue":
        this.attach(false);
        break;
      case "nullValue":
        this.attach(null);
        break;
      case "endObject":
      case "endArray":
        this.frames.pop();
        if (this.frames.length === 0) this.done = true;
        break;
    }
  }

  private attach(value: unknown): void {
    const parent = this.frames[this.frames.length - 1];
    if (!parent) {
      this.value = value;
      return;
    }

    if (parent.type === "array") {
      (parent.value as unknown[]).push(value);
      return;
    }

    if (parent.key !== undefined) {
      (parent.value as Record<string, unknown>)[parent.key] = value;
      parent.key = undefined;
    }
  }
}

export function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }

    const name = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(name, true);
    } else {
      args.set(name, next);
      index += 1;
    }
  }
  return args;
}

export function getStringArg(args: Map<string, string | boolean>, name: string): string | undefined {
  const value = args.get(name);
  return typeof value === "string" ? value : undefined;
}

export function getBooleanArg(args: Map<string, string | boolean>, name: string): boolean {
  return args.get(name) === true;
}

export function pathMatches(path: string[], pattern: string[]): boolean {
  if (path.length !== pattern.length) return false;
  return pattern.every((segment, index) => segment === "*" || path[index] === segment);
}

export function scalarFromToken(token: JsonToken): string | boolean | null | undefined {
  switch (token.name) {
    case "stringValue":
    case "numberValue":
      return String(token.value);
    case "trueValue":
      return true;
    case "falseValue":
      return false;
    case "nullValue":
      return null;
    default:
      return undefined;
  }
}

export function isScalarToken(token: JsonToken): boolean {
  return (
    token.name === "stringValue" ||
    token.name === "numberValue" ||
    token.name === "trueValue" ||
    token.name === "falseValue" ||
    token.name === "nullValue"
  );
}

export async function parseJsonTokens(
  stream: Readable,
  onToken: (token: JsonToken) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const jsonParser = parser();
    let settled = false;

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    stream.on("error", finish);
    jsonParser.on("error", finish);
    jsonParser.on("end", () => finish());
    jsonParser.on("data", (token: JsonToken) => {
      try {
        onToken(token);
      } catch (error) {
        jsonParser.destroy(error as Error);
        finish(error);
      }
    });

    stream.pipe(jsonParser);
  });
}

export async function openDecodedInput(
  input: string,
  options: { tolerate404?: boolean; method?: "GET" | "HEAD" } = {},
): Promise<{ stream: Readable | null; status?: number; headers?: Headers }> {
  if (/^https?:\/\//i.test(input)) {
    return openHttpInput(input, options);
  }

  if (options.method === "HEAD") {
    return { stream: null, status: 200, headers: new Headers() };
  }

  return { stream: await sniffGzip(createReadStream(input)) };
}

async function openHttpInput(
  input: string,
  options: { tolerate404?: boolean; method?: "GET" | "HEAD" },
): Promise<{ stream: Readable | null; status: number; headers: Headers }> {
  const method = options.method ?? "GET";
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(input, { method, redirect: "follow" });
      if (response.status === 404 && options.tolerate404) {
        return { stream: null, status: 404, headers: response.headers };
      }

      if (response.status >= 500 && attempt < 3) {
        await delay(250 * attempt);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${input}`);
      }

      if (method === "HEAD") {
        return { stream: null, status: response.status, headers: response.headers };
      }

      if (!response.body) {
        throw new Error(`empty response body for ${input}`);
      }

      return {
        stream: await sniffGzip(Readable.fromWeb(response.body as never)),
        status: response.status,
        headers: response.headers,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function sniffGzip(stream: Readable): Promise<Readable> {
  return new Promise<Readable>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    const settle = (ended: boolean) => {
      if (settled) return;
      settled = true;
      stream.pause();
      cleanup();

      const prefix = Buffer.concat(chunks, length);
      const pass = new PassThrough();
      const decoded =
        prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b
          ? pass.pipe(createGunzip())
          : pass;

      if (prefix.length > 0) pass.write(prefix);
      if (ended) {
        pass.end();
      } else {
        stream.pipe(pass);
        stream.resume();
      }

      resolve(decoded);
    };

    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      length += buffer.length;
      if (length >= 2) settle(false);
    };

    const onEnd = () => settle(true);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
