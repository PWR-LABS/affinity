/** Run against a loopback candidate connected to the same disposable database.
 * Create affinity_coverage_handoffs_e2e and apply the Prisma schema before running.
 */
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { chromium } = require(process.env.AFFINITY_PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.AFFINITY_EVAL_APP_URL);
assert.equal(base.hostname, '127.0.0.1');
const dbUrl = new URL(process.env.AFFINITY_COVERAGE_HANDOFFS_TEST_DATABASE_URL);
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.pathname, '/affinity_coverage_handoffs_e2e');

async function seed() {
  const db = new PrismaClient({datasourceUrl: dbUrl.href});
  try {
    const now = new Date();
    const sourceDate = new Date(now.getTime() - 86400000);
    await db.ticFile.upsert({
      where: {id: 'handoff-fixture-file'},
      update: {sourceLastUpdated: sourceDate},
      create: {
        id: 'handoff-fixture-file', reportingEntity: 'Synthetic issuer', url: 'https://example.com/handoff-fixture',
        fetchedAt: now, sourceLastUpdated: sourceDate,
        memberships: {create: {npi: '1234567890', tinType: 'ein', tinValue: '111111111'}},
        planLinks: {create: {planIdType: 'ein', planId: '111111111', planName: 'Synthetic employer plan'}},
      },
    });
    for (const [contractId, planName, formularyId] of [
      ['S9001', 'Synthetic indexed plan', 'synthetic-indexed-formulary'],
      ['S9002', 'Synthetic missing-formulary plan', 'synthetic-missing-formulary'],
    ]) {
      const identity = {contractId, planId: '001', segmentId: '000', contractYear: 2026};
      await db.partDPlan.upsert({
        where: {contractId_planId_segmentId_contractYear: identity},
        update: {},
        create: {...identity, planName, formularyId, state: 'OH', pdpRegionCode: '14'},
      });
    }
    const drug = {formularyId: 'synthetic-indexed-formulary', contractYear: 2026, rxcui: '860975'};
    await db.partDFormularyDrug.upsert({
      where: {formularyId_contractYear_rxcui: drug}, update: {}, create: {...drug, tier: 2},
    });
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  await seed();
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.AFFINITY_TEST_BROWSER_CHANNEL ? {channel: process.env.AFFINITY_TEST_BROWSER_CHANNEL} : {}),
  });
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 960}});
    const errors = [], observed = [], passed = [];
    page.on('pageerror', error => errors.push(error.message));
    const label = (name) => page.getByLabel(name, {exact: true});
    const combo = (name) => page.getByRole('combobox', {name, exact: true});
    const button = (name) => page.getByRole('button', {name, exact: true});
    const namedLink = (name) => page.getByRole('link', {name, exact: true});
    const option = (name) => page.getByRole('option', {name, exact: true});
    const primary = page.getByRole('navigation', {name: 'Primary'});
    const submit = page.locator('form button[type="submit"]');

    await page.route('**/api/providers/autocomplete', (route) => {
      observed.push(route.request().postDataJSON());
      return route.fulfill({json: {items: [{npi: '1234567890', name: 'Synthetic Doctor'}]}});
    });
    await page.goto(new URL('/plans?year=2027', base).href, {waitUntil: 'networkidle'});
    await label('ZIP code').fill('44113');
    await combo('Add your doctors').fill('Synthetic');
    await option('Synthetic Doctor').click();
    await primary.getByRole('link', {name: 'guru', exact: true}).click();
    await button('Can I keep my doctor?').click();
    await label('Coverage year').selectOption('2026');
    await namedLink('Find my doctor or employer').click();
    await combo('Your doctor').fill('Synthetic');
    await option('Synthetic Doctor').waitFor();
    assert.deepEqual(observed.map(({year}) => year), [2027, 2026]);
    await primary.getByRole('link', {name: 'Compare', exact: true}).click();
    await label('Coverage year').waitFor();
    assert.equal(await label('Coverage year').inputValue(), '2026');
    assert.equal(await page.getByRole('list', {name: 'Selected doctors'}).count(), 0);
    passed.push('Doctor search honors the year chosen in guru and the plan board drops the prior-year selection.');

    await page.route('**/api/drugs/autocomplete', (route) => route.fulfill({
      json: {items: [{rxcui: '860975', label: 'Synthetic tablet 500 mg'}]},
    }));
    await page.goto(new URL('/verify/medicare-drug', base).href, {waitUntil: 'networkidle'});
    await label('State code for standalone Part D plans').fill('OH');
    async function selectDrug() {
      await combo('Your medications').fill('Synthetic');
      await option('Synthetic tablet 500 mg RxCUI 860975').click();
    }
    await selectDrug();
    const shortlist = page.getByRole('status', {name: 'Part D plan shortlist'});
    const exact = page.getByRole('status', {name: 'Medication coverage results'});
    let started, release, done;
    const arrived = new Promise(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const returned = new Promise(resolve => { done = resolve; });
    await page.route('**/api/partd/shortlist', async (route) => {
      const input = route.request().postDataJSON();
      assert.equal(input.state, 'OH');
      started();
      await pending;
      await route.fulfill({json: {
        state: 'OH', contractYear: 2026, medicationCount: 1, plansEvaluated: 0, confidence: 0.65, plans: [],
      }}).catch(() => {});
      done();
    });
    await submit.click();
    await arrived;
    await label('State code for standalone Part D plans').fill('PA');
    await page.waitForFunction(() => !document.querySelector('form[aria-busy]').matches('[aria-busy="true"]'));
    release();
    await returned;
    assert.equal(await shortlist.count(), 0);
    await page.unroute('**/api/partd/shortlist');

    await label('State code for standalone Part D plans').fill('OH');
    await submit.click();
    await shortlist.getByText('2026 formulary-fit shortlist').waitFor();
    assert.equal(await shortlist.locator('.partd-shortlist-row').count(), 1);
    await shortlist.getByRole('heading', {name: 'Synthetic indexed plan'}).waitFor();
    assert.equal(await shortlist.getByRole('heading', {name: 'Synthetic missing-formulary plan'}).count(), 0);
    passed.push('Part D ignores the canceled Ohio reply after a state edit and only ranks plans with indexed formularies.');

    await button('Check a plan I know').click();
    async function selectPlan(query, name) {
      await combo('Your Medicare drug plan').fill(query);
      await page.getByRole('option', {name: new RegExp(name)}).click();
      await submit.click();
    }
    await selectPlan('indexed', 'Synthetic indexed plan');
    await exact.getByText('2026 coverage results').waitFor();
    await exact.getByText('Synthetic indexed plan · S9001-001').waitFor();
    assert.equal(await exact.locator('[data-verdict="covered"]').count(), 1);

    await selectPlan('missing-formulary', 'Synthetic missing-formulary plan');
    await exact.getByText('Synthetic missing-formulary plan · S9002-001').waitFor();
    assert.equal(await exact.locator('[data-verdict="unknown"]').count(), 1);
    assert.equal(await exact.locator('[data-verdict="not-covered"]').count(), 0);
    passed.push('Exact results identify the year and plan and show an unloaded formulary as unknown.');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed, usedLiveModel: false}, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
