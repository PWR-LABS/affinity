/** Loopback-only synthetic browser acceptance. No live model/data requests. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.AFFINITY_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.AFFINITY_EVAL_APP_URL;
assert.equal(new URL(base).hostname,'127.0.0.1');
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.AFFINITY_TEST_BROWSER_CHANNEL?{channel:process.env.AFFINITY_TEST_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 const failures=[],passed=[];page.on('pageerror',e=>failures.push(e.message));
 let networkMode='listed',delayedRelease,received=false;
 try{
  await page.route('**/api/eligibility',route=>{
   const c=route.request().postDataJSON();assert.equal(route.request().method(),'POST');assert.equal(new URL(route.request().url()).search,'');
   return route.fulfill({json:{year:c.year,zip:c.zip,state:c.state,verdict:'marketplace',headline:'Synthetic screening: explore Marketplace options',nextSteps:['Confirm eligibility through the official Marketplace.'],notes:['Synthetic fixture, not a live eligibility result.']}});
  });
  await page.route('**/api/tic/verify',async route=>{
   const c=route.request().postDataJSON();
   const data={npi:c.npi,plan:{idType:c.planIdType,id:c.planId},value:networkMode==='absent'?'unknown':'yes',source:'SYNTHETIC_ISSUER_FIXTURE',sourceUpdated:networkMode==='stale'?'2020-01-01':new Date(Date.now()-86400000).toISOString(),evidenceStatus:networkMode==='listed'?'listed':networkMode==='absent'?'incomplete_index':networkMode==='stale'?'listed':'conflict',sourceUrl:'https://example.com/synthetic-network.json',explanation:'Synthetic source fixture. Missing or conflicting evidence is not an exclusion.'};
   if(networkMode==='delayed'){received=true;await new Promise(r=>{delayedRelease=r;});}
   await route.fulfill({json:data}).catch(()=>{});
  });
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Work it out with guru.'}).waitFor();
  await page.getByLabel('State',{exact:true}).selectOption('OH');await page.getByLabel('ZIP code',{exact:true}).fill('44113');
  await page.getByLabel('Your age',{exact:true}).fill('35');await page.getByLabel('Annual household income ($)',{exact:true}).fill('30000');
  await page.getByLabel('Work situation',{exact:true}).selectOption('working');
  await page.getByRole('button',{name:'Check Medicaid / Marketplace routes',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'affordability'}).waitFor();
  await page.getByLabel('Employer insurance offer',{exact:true}).selectOption('none');
  await page.getByRole('button',{name:'Check Medicaid / Marketplace routes',exact:true}).click();
  await page.getByRole('heading',{name:'Synthetic screening: explore Marketplace options'}).waitFor();
  passed.push('employment is distinct from an actual offer; screening is explicit and source-limited');
  await page.getByRole('button',{name:'Next: check my care →'}).click();
  await page.getByLabel('Doctor NPI',{exact:true}).fill('1234567890');await page.getByLabel('Plan / employer identifier',{exact:true}).fill('111111111');
  await page.getByRole('button',{name:'Check issuer evidence',exact:true}).click();await page.getByRole('heading',{name:'Listed in the issuer file',exact:true}).waitFor();
  await page.getByText('SYNTHETIC_ISSUER_FIXTURE',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next: compare options →'}).click();
  await page.getByLabel('Employer employee contribution ($)',{exact:true}).fill('100');await page.getByLabel('Contribution frequency',{exact:true}).selectOption('biweekly');
  await page.getByLabel('Marketplace monthly premium ($)',{exact:true}).fill('200');await page.getByLabel('Both amounts cover',{exact:true}).selectOption('self');
  await page.getByRole('button',{name:'Compare declared premiums',exact:true}).click();await page.getByText('$2,600.00',{exact:true}).waitFor();
  await page.getByText('$2,400.00',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next: make a confirmation plan →'}).click();
  await page.getByRole('link',{name:'HealthCare.gov',exact:true}).waitFor();
  await page.getByRole('button',{name:'Next confirmation',exact:true}).click();assert.match(await page.locator('.guru-walkthrough [aria-current=step]').innerText(),/insurer/);
  passed.push('Discover → dated care-fit evidence → declared premium comparison → official confirmation handoff');
  const discover=page.getByRole('button',{name:'1 Discover',exact:true});await discover.focus();await page.keyboard.press('Tab');await page.keyboard.press('Space');
  await page.getByRole('heading',{name:'Can your care come with you?',exact:true}).waitFor();
  passed.push('journey controls work with keyboard Tab and Space');
  for(const mode of ['absent','stale','conflict']){
   networkMode=mode;await page.getByRole('button',{name:'Check issuer evidence',exact:true}).click();
   await page.getByRole('heading',{name:'Coverage remains unknown',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Listed in the issuer file',exact:true}).count(),0);
  }
  fs.mkdirSync('tmp/guru-demo',{recursive:true});await page.screenshot({path:'tmp/guru-demo/unknown.png',fullPage:true});
  passed.push('absent, stale and conflicting source fixtures stay unknown with a concrete handoff');
  networkMode='delayed';await page.getByRole('button',{name:'Check issuer evidence',exact:true}).click();
  await page.waitForFunction(()=>true);for(let i=0;i<50&&!received;i++)await page.waitForTimeout(20);assert.ok(received);
  await page.getByLabel('Doctor NPI',{exact:true}).fill('1234567891');delayedRelease();await page.waitForTimeout(200);
  assert.equal(await page.getByRole('heading',{name:'Listed in the issuer file',exact:true}).count(),0);
  await discover.click();assert.equal(await page.getByLabel('ZIP code',{exact:true}).inputValue(),'44113');
  await page.getByLabel('ZIP code',{exact:true}).fill('44114');assert.equal(await page.getByRole('heading',{name:'Synthetic screening: explore Marketplace options'}).count(),0);
  passed.push('context survives views; corrections invalidate affected evidence and ignore late responses');
  await page.getByLabel('Use connected AI for question routing and proposed edits',{exact:true}).check();
  await page.route('**/api/guru',r=>r.fulfill({json:{mode:'connected',proposal:{step:'discover',changes:{state:'PA',zip:'19103'}}}}));
  await page.getByLabel('What would you like to work out?',{exact:true}).fill('Actually I live in Pennsylvania, ZIP 19103');await page.getByRole('button',{name:'Find my next step',exact:true}).click();
  await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).waitFor();assert.equal(await page.getByLabel('State',{exact:true}).inputValue(),'OH');
  await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).click();assert.equal(await page.getByLabel('State',{exact:true}).inputValue(),'PA');assert.equal(await page.getByLabel('ZIP code',{exact:true}).inputValue(),'19103');
  passed.push('mocked AI only proposes context; confirmation applies it, with no model coverage badge');
  await page.unroute('**/api/guru');await page.route('**/api/guru',r=>r.fulfill({status:503,json:{mode:'guided'}}));
  await page.getByLabel('What would you like to work out?',{exact:true}).fill('Compare my options');await page.getByRole('button',{name:'Find my next step',exact:true}).click();
  await page.getByText('Connected AI is unavailable for this turn.',{exact:false}).waitFor();
  await page.getByLabel('Compare with Marketplace',{exact:true}).selectOption('medicaid');await page.getByLabel('Confirmed Medicaid monthly premium ($)',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Compare declared premiums',exact:true}).click();await page.getByText('$0.00',{exact:true}).waitFor();
  passed.push('AI failure preserves guided mode, including explicit Medicaid vs Marketplace comparison');
  fs.mkdirSync('tmp/guru-demo',{recursive:true});await page.screenshot({path:'tmp/guru-demo/wide.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await discover.click();
  assert.equal(await page.getByLabel('ZIP code',{exact:true}).inputValue(),'19103');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'tmp/guru-demo/mobile.png',fullPage:true});passed.push('390px layout stacks without horizontal overflow and retains context');
  await page.getByRole('navigation',{name:'Primary',exact:true}).getByRole('link',{name:'Compare',exact:true}).click();
  await page.getByRole('heading',{name:'See your real plans',exact:true}).waitFor();
  assert.equal(await page.getByLabel('ZIP code',{exact:true}).inputValue(),'19103');
  assert.equal(await page.getByLabel('Employer insurance offer',{exact:true}).inputValue(),'none');
  await page.getByLabel('ZIP code',{exact:true}).fill('19104');
  await page.route('**/api/drugs/autocomplete',r=>r.fulfill({json:{items:[{rxcui:'860975',label:'Synthetic metformin 500 mg'}]}}));
  await page.getByRole('combobox',{name:'Add your medications',exact:true}).fill('metformin');
  await page.getByRole('option').filter({hasText:'Synthetic metformin 500 mg'}).click();
  await page.getByRole('navigation',{name:'Primary',exact:true}).getByRole('link',{name:'guru',exact:true}).click();
  await page.getByLabel('ZIP code',{exact:true}).waitFor();assert.equal(await page.getByLabel('ZIP code',{exact:true}).inputValue(),'19104');
  await page.getByRole('navigation',{name:'Primary',exact:true}).getByRole('link',{name:'Compare',exact:true}).click();
  await page.getByRole('list',{name:'Selected medications',exact:true}).getByText('Synthetic metformin 500 mg',{exact:true}).waitFor();
  passed.push('shared household fields and selected medications survive guru ↔ full-form navigation without URL storage');
  assert.deepEqual(failures,[]);console.log(JSON.stringify({passed,fixtures:true,liveModelCalls:0,liveSourceCalls:0,screenshots:['tmp/guru-demo/wide.png','tmp/guru-demo/mobile.png']},null,2));
 }finally{if(delayedRelease)delayedRelease();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
