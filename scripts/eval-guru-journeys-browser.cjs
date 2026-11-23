/** Browser acceptance for guided questions, evidence boundaries and degraded connected turns. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.AFFINITY_PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.AFFINITY_EVAL_APP_URL);
assert.equal(base.hostname, '127.0.0.1', 'The fixture runner must use a loopback app');

const questions = {
  'Find coverage options': [
    'I lost Medicaid', 'How do I get insurance after losing Medicaid?',
    'I work part time. What are my coverage options?', 'My spouse was offered employer insurance.',
    'I have no insurance', 'Can I qualify for a Marketplace subsidy?',
    'I am switching jobs and I do not know when my insurance ends.',
    'What are my options after COBRA ends?', 'When is open enrollment?',
  ],
  'Check whether you can keep your doctor': [
    'Can I keep my doctor?', 'Is my specialist in network?', 'Can you check this doctor against my employer?',
    'I have my NPI and HIOS identifiers.', 'Can I keep my hospital?', 'Can you check my provider against this EIN?',
  ],
  'Find Marketplace premium estimates': [
    'Can I see 2027 Marketplace plans?', 'How much would an ACA plan cost?',
    'Can I see Obamacare premiums?', 'Find prices for plans on HealthCare.gov',
  ],
  'Compare the premiums you’d pay': [
    'Compare my employer offer', 'Compare Medicaid vs. Marketplace premiums',
    'Will Marketplace be cheaper than my job plan?', 'I pay every two weeks via paycheck',
  ],
  'Check a Medicare Part D medication': [
    'Does Medicare Part D cover my prescription?', 'Which Medicare formulary lists this medication?',
    'Find my 2027 Part D drug coverage',
  ],
  'Check prescription coverage': [
    'Is my prescription covered on Marketplace plans?', 'Will this plan cover my medication?',
    'Can I compare ACA formularies for insulin?',
  ],
  'Get Medicare enrollment guidance': [
    'How do I sign up for Medicare?', 'Can I get Medicare at 65 if I still work?',
  ],
  'See how your answers are used': [
    'Do you store my answers?', 'What do you send to OpenAI?', 'Where is the privacy page?',
  ],
  'Confirm your coverage before enrolling': [
    'How do I confirm eligibility before enrolling?', 'How does guru work?', 'Where can I review your sources?',
  ],
};

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.AFFINITY_TEST_BROWSER_CHANNEL ? { channel: process.env.AFFINITY_TEST_BROWSER_CHANNEL } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.setDefaultTimeout(5000);
    const coverage = page.getByRole('region', { name: 'Your coverage workspace', exact: true });
    const log = page.getByRole('log');
    const label = (name) => page.getByLabel(name, { exact: true });
    const button = (name) => page.getByRole('button', { name, exact: true });
    const heading = (name) => coverage.getByRole('heading', { name, exact: true });
    const errors = [], passed = [], unexpected = [], calls = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let planResponse = 'valid', networkResponse = 'listed', doctorResponse = 'unavailable', modelResponse;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const input = request.postDataJSON();
      calls.push({ path, input });
      if (path === '/api/guru' && modelResponse) return route.fulfill(modelResponse);
      if (path === '/api/eligibility') return route.fulfill({
        json: { year: input.year, state: input.state, headline: 'Synthetic coverage screening', verdict: 'marketplace' },
      });
      if (path === '/api/plans') {
        if (planResponse === 'unavailable') return route.fulfill({ status: 503, body: '<html>Unavailable</html>' });
        if (planResponse === 'county_ambiguous') return route.fulfill({
          status: 409, json: { code: 'county_ambiguous', error: 'This ZIP spans multiple counties. Use the official Marketplace.' },
        });
        return route.fulfill({
          json: {
            year: planResponse === 'wrong-year' ? 2027 : input.year,
            county: 'Synthetic County', state: planResponse === 'wrong-state' ? 'PA' : 'OH',
            totalPlans: planResponse === 'empty' ? 0 : 6,
            plans: planResponse === 'empty' ? [] : Array.from({ length: 6 }, (_, i) => ({
              id: 'fixture' + i, name: 'Synthetic Marketplace plan ' + i, netPremiumMonthly: i * 20,
            })),
          },
        });
      }
      if (path === '/api/providers/autocomplete') {
        if (doctorResponse === 'unavailable') return route.fulfill({ status: 503, json: {} });
        return route.fulfill({ json: { items: doctorResponse === 'empty' ? [] : [{ npi: '1234567890', name: 'Dr Morgan Sample' }] } });
      }
      if (path === '/api/tic/plans') return route.fulfill({
        json: { items: [{ planIdType: 'hios', planId: '12345OH0010001', planName: 'Synthetic HIOS Plan' }] },
      });
      if (path === '/api/tic/verify') {
        if (networkResponse === 'unavailable') return route.fulfill({ status: 502, body: 'Unavailable' });
        return route.fulfill({
          json: {
            npi: input.npi, plan: { idType: input.planIdType, id: input.planId }, value: 'yes',
            evidenceStatus: networkResponse, source: 'SYNTHETIC_FIXTURE',
            sourceUpdated: new Date(Date.now() - 86400000).toISOString(),
          },
        });
      }
      unexpected.push(path);
      return route.abort();
    });

    async function ask(message, expected) {
      await label('What would you like to work out?').fill(message);
      await button('Send to guru').click();
      await heading(expected).waitFor();
    }
    async function clear() {
      await button('Clear this workspace').click();
      await heading('Start with a question').waitFor();
    }

    await page.goto(base.href, { waitUntil: 'networkidle', timeout: 30000 });
    for (const [expected, prompts] of Object.entries(questions)) {
      for (const prompt of prompts) {
        await clear();
        await ask(prompt, expected);
      }
    }
    await clear();
    await ask('Is a bicycle faster than walking?', 'Start with a question');
    await log.getByText(/What would you like to check/).waitFor();
    assert.equal(calls.length, 0, 'Asking or clarifying a question must not run a tool in guided mode');
    passed.push('37 covered question variants and one unsupported question, with no automatic lookups');

    await ask('I lost Medicaid', 'Find coverage options');
    await button('Check Medicaid / Marketplace routes').click();
    await coverage.getByRole('alert').filter({hasText:'Which state'}).waitFor();
    await label('State').selectOption('OH');
    await button('Check Medicaid / Marketplace routes').click();
    await heading('Clarify the offer; keep your coverage routes open').waitFor();
    await label('Employer insurance offer').selectOption('offered_household');
    await button('Check Medicaid / Marketplace routes').click();
    await heading('Keep Medicaid open and review the employer offer').waitFor();
    assert.equal(calls.length,0);
    await label('Employer insurance offer').selectOption('none');
    await label('ZIP code').fill('44113');
    await label('Your age').fill('40');
    await label('Annual household income ($)').fill('0');
    await button('Check Medicaid / Marketplace routes').click();
    await heading('Synthetic coverage screening').waitFor();
    assert.equal(calls.at(-1).input.income,0);
    passed.push('screening requires a state, preserves zero income, and distinguishes no offer from unknown and household offers');

    await label('State').selectOption('OR');
    await label('Coverage year').selectOption('2027');
    assert.equal(await coverage.getByRole('link',{name:/Explore Health/}).getAttribute('href'),'https://explorehealthor.gov');
    await label('Coverage year').selectOption('2026');
    assert.equal(await coverage.getByRole('link',{name:'HealthCare.gov'}).getAttribute('href'),'https://www.healthcare.gov/');
    await label('State').selectOption('OH');
    passed.push('the Oregon Marketplace handoff uses the official HTTPS URL and follows the coverage year');

    await ask('Find 2027 Marketplace plans', 'Find Marketplace premium estimates');
    await label('Coverage year').selectOption('2027');
    await button('Find Marketplace estimates').click();
    await heading('Marketplace options for your confirmed inputs').waitFor();
    assert.equal(calls.at(-1).input.year,2027);
    await coverage.getByText(/Showing the first five results/).waitFor();
    assert.equal(await coverage.getByText('Synthetic Marketplace plan 5', { exact: false }).count(), 0);
    await label('Coverage year').selectOption('2026');
    assert.equal(await heading('Marketplace options for your confirmed inputs').count(),0);
    await button('Find Marketplace estimates').click();
    await heading('Marketplace options for your confirmed inputs').waitFor();
    assert.equal(calls.at(-1).input.year,2026);
    for (const [mode, expected] of [
      ['wrong-state','ZIP code did not match'], ['wrong-year','plan response did not match'],
      ['county_ambiguous','ZIP spans multiple counties'], ['unavailable','unreadable result'],
    ]) {
      planResponse = mode;
      await button('Find Marketplace estimates').click();
      await coverage.getByRole('alert').filter({hasText:expected}).waitFor();
      assert.equal(await heading('Marketplace options for your confirmed inputs').count(),0);
    }
    planResponse = 'empty';
    await button('Find Marketplace estimates').click();
    await heading('No Marketplace plans returned').waitFor();
    await label('Employer insurance offer').selectOption('offered');
    const callCount = calls.length;
    await button('Find Marketplace estimates').click();
    await heading('Keep Medicaid open and review the employer offer').waitFor();
    assert.equal(calls.length,callCount);
    assert.ok(await coverage.locator('#guru-evidence-plans').count());
    passed.push('2026/2027 estimates, five-result disclosure, state/year mismatch and county ambiguity, empty and failed response, offer handoff');

    await ask('Can I keep my doctor?', 'Check whether you can keep your doctor');
    await ask('Same area, thanks.', 'Check whether you can keep your doctor');
    const doctor = page.getByRole('combobox', { name: 'Find your doctor by name', exact: true });
    await doctor.fill('No test match');
    await coverage.getByRole('status').filter({hasText:'Search is temporarily unavailable'}).waitFor();
    doctorResponse = 'empty';
    await doctor.fill('Missing test doctor');
    await coverage.getByRole('option').filter({hasText:'No matches'}).waitFor();
    await doctor.press('Escape');
    assert.equal(await doctor.getAttribute('aria-expanded'),'false');
    doctorResponse = 'valid';
    await doctor.fill('Morgan');
    await coverage.getByRole('option',{name:'Dr Morgan Sample',exact:true}).waitFor();
    assert.ok(await doctor.getAttribute('aria-activedescendant'));
    await doctor.press('Enter');
    await page.getByRole('combobox',{name:'Or find your plan by name'}).fill('synthetic');
    await coverage.getByRole('option',{name:'Synthetic HIOS Plan',exact:true}).click();
    await button('Check issuer evidence').click();
    await heading('Listed in the issuer file').waitFor();
    assert.equal(calls.at(-1).input.planIdType,'hios');
    networkResponse = 'unavailable';
    await button('Check issuer evidence').click();
    await coverage.getByRole('alert').filter({hasText:'unreadable result'}).waitFor();
    assert.equal(await heading('Listed in the issuer file').count(),0);
    assert.equal(await log.locator('[data-superseded=true]').filter({hasText:'Listed in the issuer file'}).count(),1);
    passed.push('doctor lookup distinguishes empty and unavailable, keyboard selection works, and failed recheck withdraws the old listing');

    await ask('Compare my employer offer', 'Compare the premiums you’d pay');
    await label('Employer employee contribution ($)').fill('100');
    await label('Marketplace monthly premium ($)').fill('200');
    await button('Compare declared premiums').click();
    await coverage.getByRole('alert').filter({hasText:'same household members'}).waitFor();
    await label('Both amounts cover').selectOption('self');
    for (const [frequency, annual] of [
      ['weekly','$5,200.00'],['biweekly','$2,600.00'],['semimonthly','$2,400.00'],['monthly','$1,200.00'],
    ]) {
      await label('Contribution frequency').selectOption(frequency);
      await button('Compare declared premiums').click();
      await coverage.locator('#guru-evidence-premium dd').nth(2).getByText(annual,{exact:true}).waitFor();
    }
    await label('Compare with Marketplace').selectOption('medicaid');
    assert.equal(await label('Confirmed Medicaid monthly premium ($)').inputValue(),'');
    await label('Confirmed Medicaid monthly premium ($)').fill('0');
    await button('Compare declared premiums').click();
    await coverage.getByText('$0.00',{exact:true}).waitFor();
    passed.push('all four pay frequencies, same-people confirmation, explicit zero Medicaid premium');

    for (const scope of ['site','visitor','network']) {
      for (const window of ['minute','day','month']) {
        await clear();
        modelResponse = {status:429,json:{code:'guru_limit',scope,window}};
        await label('Use connected guru').check();
        await ask('Can I keep my doctor?', 'Check whether you can keep your doctor');
        await log.getByText(/AI allowance has been reached/).waitFor();
        await label('ZIP code').waitFor();
      }
    }
    await clear();
    modelResponse = {status:503,json:{mode:'guided'}};
    await label('Use connected guru').check();
    await ask('Can I see 2027 Marketplace plans?', 'Find Marketplace premium estimates');
    await log.getByText(/Connected guru is unavailable/).waitFor();
    const beforeHandoff = calls.length;
    await ask('Does Medicare Part D cover my prescription?', 'Check a Medicare Part D medication');
    assert.equal(calls.length,beforeHandoff);
    await coverage.getByRole('link',{name:'Open the Part D medication checker'}).click();
    await page.waitForURL('**/verify/medicare-drug');
    await page.getByText(/Compare 2026 statewide standalone/).waitFor();
    assert.equal(await page.getByRole('link',{name:'Medicare Plan Compare'}).getAttribute('href'),'https://www.medicare.gov/plan-compare/');
    passed.push('all nine quota combinations and 503 preserve guided progress, with a working Part D handoff and explicit index year');

    assert.deepEqual(unexpected,[]);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({
      passed, questionVariants:Object.values(questions).flat().length+1,
      mockedModelTurns:calls.filter(call=>call.path==='/api/guru').length,
      liveModelCalls:0, fixtureData:true,
    },null,2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
