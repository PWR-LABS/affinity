/** Synthetic end-to-end gate: isolated loopback PostgreSQL + candidate app only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { chromium } = require(process.env.AFFINITY_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.AFFINITY_EVAL_APP_URL;
const dbUrl = new URL(process.env.DATABASE_URL || '');
assert.equal(new URL(base).hostname, '127.0.0.1');
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.pathname, '/affinity_employer_e2e', 'dedicated synthetic database required');
const db = new PrismaClient();
const passed = [];
const npi = '1234567890';
const recent = new Date(Date.now() - 86400000);
async function file(id, date, membership = true, link = true) {
  return db.ticFile.create({ data: {
    url: `https://example.com/synthetic-${id}.json`, reportingEntity: 'Synthetic issuer', fetchedAt: new Date(), sourceLastUpdated: date,
    memberships: membership ? { create: { npi, tinType: 'ein', tinValue: '000000000' } } : undefined,
    planLinks: link ? { create: { planName: `Synthetic ${id}`, planIdType: 'ein', planId: id } } : undefined,
  } });
}
async function verify(id, provider = npi) {
  const response = await fetch(`${base}/api/tic/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ npi: provider, planIdType: 'ein', planId: id }) });
  assert.equal(response.status, 200);
  return response.json();
}
async function main() {
  let browser;
  try {
    await db.ticFile.deleteMany();
    const fresh = await file('111111111', recent);
    await file('222222222', new Date(Date.now() - 61 * 86400000));
    await file('333333333', null);
    await file('444444444', new Date(Date.now() + 86400000));
    await file('555555555', recent, true, false);
    await file('666666666', recent, false, true);
    const hit = await verify('111111111');
    assert.equal(hit.value, 'yes');
    assert.equal(hit.evidenceStatus, 'listed');
    assert.equal(hit.sourceUrl, fresh.url);
    assert.equal(hit.sourceUpdated, recent.toISOString());
    assert.match(hit.rendered, /listed in an issuer file/);
    passed.push('real join returns a dated, source-attributed listing');
    for (const [id, provider, status] of [
      ['111111111', '9999999999', 'incomplete_index'],
      ['999999999', npi, 'plan_missing'],
      ['222222222', npi, 'source_stale'],
      ['222222222', '9999999999', 'source_stale'],
      ['333333333', npi, 'source_date_unknown'],
      ['444444444', npi, 'source_date_unknown'],
    ]) {
      const result = await verify(id, provider);
      assert.equal(result.value, 'unknown');
      assert.equal(result.evidenceStatus, status);
      assert.equal(result.needsConfirmation, true);
      assert.ok(result.explanation.length > 30);
    }
    passed.push('API withholds partial absence, missing plans, stale, undated, and future-dated matches');
    const search = await (await fetch(`${base}/api/tic/plans?q=Synthetic`)).json();
    assert.deepEqual(search.items.map(p => p.planId), ['111111111']);
    passed.push('search offers only recent files with joined provider data');
    browser = await chromium.launch({ headless: true, ...(process.env.AFFINITY_CHROME_PATH ? { executablePath: process.env.AFFINITY_CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${base}/verify`);
    await page.locator('#v-npi').fill(npi);
    await page.locator('#v-ein').fill('111111111');
    await page.getByRole('button', { name: 'Verify coverage', exact: true }).click();
    await page.locator('.verdict-card[data-verdict="covered"]').waitFor();
    assert.match(await page.locator('.verdict-card').innerText(), /listed in issuer file/i);
    await page.locator('#v-npi').fill('9999999999');
    assert.equal(await page.locator('.verdict-card').count(), 0);
    await page.getByRole('button', { name: 'Verify coverage', exact: true }).click();
    await page.locator('.verdict-card[data-verdict="unknown"]').waitFor();
    assert.match(await page.locator('.verdict-card').innerText(), /absence is not an out-of-network result/);
    passed.push('desktop submits real lookup; editing the provider clears the previous answer');
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const arrived = new Promise(resolve => { started = resolve; });
    await page.route('**/api/tic/verify', async route => {
      const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Verify coverage', exact: true }).click();
    await arrived;
    await page.locator('#v-ein').fill('999999999');
    const response = page.waitForResponse(r => r.url().endsWith('/api/tic/verify'));
    release(); await response;
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.verdict-card').count(), 0);
    await page.unroute('**/api/tic/verify');
    passed.push('late response cannot restore an answer after the plan changes');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#v-ein').fill('222222222');
    await page.getByRole('button', { name: 'Verify coverage', exact: true }).click();
    await page.locator('.verdict-card').waitFor();
    assert.match(await page.locator('.verdict-card').innerText(), /60-day limit/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    fs.mkdirSync('tmp/employer-e2e', { recursive: true });
    await page.screenshot({ path: 'tmp/employer-e2e/mobile-stale.png', fullPage: true });
    passed.push('mobile renders stale-source explanation without horizontal overflow');
    await db.ticFile.delete({ where: { id: fresh.id } });
    await page.reload();
    await page.getByText('Recent employer sources unavailable.', { exact: true }).waitFor();
    assert.equal(await page.locator('#v-npi').count(), 0);
    assert.match(await page.locator('.coverage-unavailable').innerText(), /missing, undated, or overdue/);
    passed.push('readiness rejects stale/future/undated data and unrelated fresh plan/provider rows');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), passed }, null, 2));
  } finally {
    await browser?.close();
    await db.ticFile.deleteMany();
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
