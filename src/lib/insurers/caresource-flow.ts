import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { beginCareSource, careSourceConfig, COVERAGE_ORIGIN, readCareSourceCoverage } from "./caresource";

const FLOW_COOKIE = "__Host-affinity-care-source-flow";
const CODE_COOKIE = "__Host-affinity-care-source-code";
const FLOW_SECONDS = 600;
const CODE_SECONDS = 90;
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const flowSchema = z.object({ state: token, verifier: token });
const codeSchema = z.object({ code: z.string().regex(/^[!-~]{1,1024}$/), verifier: token });

function seal(key: Buffer, cookie: string, data: object, seconds: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(cookie));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ data, expires: Date.now() + seconds * 1000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function open(key: Buffer, cookie: string, value?: string): unknown {
  if (!value || !/^[a-zA-Z0-9_-]{40,2048}$/.test(value)) return undefined;
  try {
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(cookie));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const answer = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (typeof answer.expires === "number" && answer.expires > Date.now()) return answer.data;
  } catch {
    // Expired, malformed, and modified handoff cookies are handled as unavailable.
  }
}

function cleanRedirect(status: "ready" | "declined" | "unavailable"): NextResponse {
  return NextResponse.redirect(new URL(`/verify/my-coverage?connection=${status}`, COVERAGE_ORIGIN), {
    status: 303, headers: PRIVATE_HEADERS,
  });
}

function clearCookie(response: NextResponse, name: string): void {
  response.cookies.set(name, "", { ...COOKIE_OPTIONS, maxAge: 0 });
}

function sameOrigin(req: NextRequest): boolean {
  return req.headers.get("origin") === COVERAGE_ORIGIN;
}

export async function startCareSource(req: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(req)) return new NextResponse(null, { status: 403, headers: PRIVATE_HEADERS });
  const config = careSourceConfig();
  if (!config) return new NextResponse(null, { status: 503, headers: PRIVATE_HEADERS });
  const { url, state, verifier } = beginCareSource(config);
  const response = NextResponse.json({ authorizationUrl: url.href }, { headers: PRIVATE_HEADERS });
  clearCookie(response, CODE_COOKIE);
  response.cookies.set(FLOW_COOKIE, seal(config.cookieKey, FLOW_COOKIE, { state, verifier }, FLOW_SECONDS), {
    ...COOKIE_OPTIONS, maxAge: FLOW_SECONDS,
  });
  return response;
}

export async function finishCareSource(req: NextRequest): Promise<NextResponse> {
  const config = careSourceConfig();
  const params = req.nextUrl.searchParams;
  const flow = flowSchema.safeParse(config && open(config.cookieKey, FLOW_COOKIE, req.cookies.get(FLOW_COOKIE)?.value));
  const state = token.safeParse(params.get("state"));
  const validState = flow.success && state.success && params.getAll("state").length === 1 &&
    timingSafeEqual(Buffer.from(flow.data.state), Buffer.from(state.data));
  if (!config || !flow.success || !validState) {
    // A stale or unrelated callback must not clear an in-progress connection.
    return cleanRedirect("unavailable");
  }

  const code = codeSchema.safeParse({ code: params.get("code"), verifier: flow.data.verifier });
  const denial = params.get("error");
  const ready = code.success && params.getAll("code").length === 1 && !params.has("error");
  const response = cleanRedirect(ready ? "ready" : denial === "access_denied" ? "declined" : "unavailable");
  clearCookie(response, FLOW_COOKIE);
  if (ready && code.success) {
    response.cookies.set(CODE_COOKIE, seal(config.cookieKey, CODE_COOKIE, code.data, CODE_SECONDS), {
      ...COOKIE_OPTIONS, sameSite: "strict", maxAge: CODE_SECONDS,
    });
  } else {
    clearCookie(response, CODE_COOKIE);
  }
  return response;
}

export async function returnCareSourceResult(req: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(req)) return new NextResponse(null, { status: 403, headers: PRIVATE_HEADERS });
  const config = careSourceConfig();
  const code = codeSchema.safeParse(config && open(config.cookieKey, CODE_COOKIE, req.cookies.get(CODE_COOKIE)?.value));
  let response: NextResponse;
  try {
    if (!config || !code.success) throw new Error("Coverage handoff unavailable");
    const summary = await readCareSourceCoverage(config, code.data.code, code.data.verifier);
    response = NextResponse.json(summary, { headers: PRIVATE_HEADERS });
  } catch {
    // Vendor failures can contain member data. Return only a fixed public error.
    response = NextResponse.json({ error: "Couldn’t verify your coverage." }, { status: 502, headers: PRIVATE_HEADERS });
  }
  clearCookie(response, CODE_COOKIE);
  return response;
}
