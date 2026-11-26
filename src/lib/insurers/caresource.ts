import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const CARESOURCE_FHIR_BASE = "https://orchestrateserver.caresource.careevolution.com/api/fhir/r4";
const SMART_ROOT = "https://orchestrateserver.caresource.careevolution.com/smart/auth";
export const COVERAGE_ORIGIN = "https://affinity.pwr-labs.ai";
const CALLBACK = `${COVERAGE_ORIGIN}/api/insurer/caresource/callback`;
const COVERAGE_SCOPE = "patient/Coverage.read";
const SCOPES = ["launch/patient", COVERAGE_SCOPE];
const MAX_ROWS = 10;
const FHIR_PLAN_CLASS = "http://terminology.hl7.org/CodeSystem/coverage-class";

export interface CareSourceConfig {
  clientId: string;
  clientSecret: string;
  cookieKey: Buffer;
  planIds: Set<string>;
}

export function careSourceConfig(env: Readonly<Record<string, string | undefined>> = process.env): CareSourceConfig | null {
  const clientId = env.AFFINITY_CARESOURCE_CLIENT_ID?.trim();
  const clientSecret = env.AFFINITY_CARESOURCE_CLIENT_SECRET;
  const cookieKey = env.AFFINITY_CARESOURCE_COOKIE_KEY;
  const planIds = (env.AFFINITY_CARESOURCE_OH_MEDICAID_PLAN_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (
    env.AFFINITY_CARESOURCE_ENABLED !== "1" ||
    !clientId || !clientSecret || !cookieKey || !/^[a-f0-9]{64}$/i.test(cookieKey) ||
    planIds.length === 0
  ) return null;
  return { clientId, clientSecret, cookieKey: Buffer.from(cookieKey, "hex"), planIds: new Set(planIds) };
}

export function beginCareSource(config: CareSourceConfig) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(`${SMART_ROOT}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: CALLBACK,
    scope: SCOPES.join(" "),
    aud: CARESOURCE_FHIR_BASE,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url, state, verifier };
}

const tokenSchema = z.object({
  access_token: z.string().regex(/^[!-~]{1,8192}$/),
  token_type: z.string().regex(/^Bearer$/i),
  patient: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/),
  scope: z.string().optional(),
});

const coverageSchema = z.object({
  resourceType: z.literal("Coverage"),
  beneficiary: z.object({ reference: z.string() }),
  status: z.enum(["active", "cancelled", "draft", "entered-in-error"]).optional(),
  period: z.object({ start: z.string().optional(), end: z.string().optional() }).optional(),
  class: z.array(z.object({
    type: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })) }),
    value: z.string(),
    name: z.string().optional(),
  })).optional(),
});

const bundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  type: z.literal("searchset"),
  total: z.number().int().nonnegative().optional(),
  link: z.array(z.object({ relation: z.string() })).optional(),
  entry: z.array(z.object({ resource: z.unknown().optional() })).optional(),
});

export interface CareSourceResult {
  checkedAt: string;
  limited: boolean;
  rows: { planName: string | null; status: "active" | "cancelled" | "unknown"; startsOn: string | null; endsOn: string | null }[];
}

function sourceDate(value?: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === date ? date : null;
}

export function summarizeCareSourceCoverage(json: unknown, patient: string, planIds: ReadonlySet<string>): CareSourceResult {
  const bundle = bundleSchema.parse(json);
  const entries = bundle.entry ?? [];
  const patientReference = `Patient/${patient}`;
  const rows: CareSourceResult["rows"] = [];
  for (const entry of entries.slice(0, MAX_ROWS)) {
    const parsed = coverageSchema.safeParse(entry.resource);
    if (!parsed.success) continue;
    const coverage = parsed.data;
    const reference = coverage.beneficiary.reference;
    if (reference !== patientReference && reference !== `${CARESOURCE_FHIR_BASE}/${patientReference}`) continue;
    const plans = coverage.class?.filter(item => item.type.coding.some(
      coding => coding.system === FHIR_PLAN_CLASS && coding.code === "plan",
    ));
    if (plans?.length !== 1 || !planIds.has(plans[0].value)) continue;
    if (coverage.status === "entered-in-error" || coverage.status === "draft") continue;
    const name = plans[0].name?.trim();
    rows.push({
      planName: name && name.length <= 100 && !/[\x00-\x1f\x7f]/.test(name) ? name : null,
      status: coverage.status ?? "unknown",
      startsOn: sourceDate(coverage.period?.start),
      endsOn: sourceDate(coverage.period?.end),
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    limited: entries.length > MAX_ROWS || (bundle.total ?? 0) > entries.length ||
      Boolean(bundle.link?.some(link => link.relation === "next")),
    rows,
  };
}

export async function readCareSourceCoverage(
  config: CareSourceConfig, code: string, verifier: string, request = fetch,
): Promise<CareSourceResult> {
  // OAuth client_secret_basic form-encodes each credential before joining them.
  const encoded = (value: string) => new URLSearchParams({ value }).toString().slice(6);
  const authorization = Buffer.from(`${encoded(config.clientId)}:${encoded(config.clientSecret)}`).toString("base64");
  const tokenResponse = await request(`${SMART_ROOT}/token`, {
    method: "POST",
    headers: { authorization: `Basic ${authorization}`, accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CALLBACK,
    }),
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  if (!tokenResponse.ok) throw new Error("CareSource token exchange failed");
  const token = tokenSchema.parse(await tokenResponse.json());
  const granted = token.scope?.trim().split(/\s+/);
  if (granted && (!granted.includes(COVERAGE_SCOPE) || granted.some(scope => !SCOPES.includes(scope)))) {
    throw new Error("CareSource returned unexpected scopes");
  }

  const coverageUrl = new URL(`${CARESOURCE_FHIR_BASE}/Coverage`);
  coverageUrl.searchParams.set("patient", token.patient);
  coverageUrl.searchParams.set("_count", String(MAX_ROWS));
  const coverageResponse = await request(coverageUrl, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/fhir+json" },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  if (!coverageResponse.ok) throw new Error("CareSource coverage request failed");
  return summarizeCareSourceCoverage(await coverageResponse.json(), token.patient, config.planIds);
}
