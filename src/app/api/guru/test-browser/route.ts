import { NextResponse } from 'next/server';
import { testBrowserFingerprint, testBrowserIdentity } from '@/lib/guru/test-browser';
import { visitorIdentity } from '@/lib/guru/visitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read back the scoped enrollment identifier from the browser being registered. */
export function GET(req: Request) {
 const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };
 if (req.headers.get('sec-fetch-site') === 'cross-site') return new NextResponse(null, { status: 403, headers });
 try {
  const { identity, cookie } = visitorIdentity(req, process.env.AFFINITY_GURU_VISITOR_SECRET, process.env.AFFINITY_GURU_CLIENT_IP_HEADER);
  return NextResponse.json({
   fingerprint: testBrowserFingerprint(identity),
   active: Boolean(testBrowserIdentity(identity, process.env.AFFINITY_GURU_TEST_BROWSER)),
  }, { headers: { ...headers, 'Set-Cookie': cookie } });
 } catch {
  return new NextResponse(null, { status: 503, headers });
 }
}
