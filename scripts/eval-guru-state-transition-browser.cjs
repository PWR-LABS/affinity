/** Fresh fictional state/transition regression; no operator data or model calls. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.AFFINITY_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.AFFINITY_EVAL_APP_URL;assert.equal(new URL(base).hostname,'127.0.0.1');
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.AFFINITY_TEST_BROWSER_CHANNEL?{channel:process.env.AFFINITY_TEST_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage();const errors=[],passed=[];page.on('pageerror',e=>errors.push(e.message));let mode='full-state';
 try{
  await page.route('**/api/guru',r=>{
   if(mode==='unavailable')return r.fulfill({status:503,json:{mode:'guided'}});
   return r.fulfill({json:{mode:'connected',reply:{step:'discover',changes:{state:mode==='unknown-state'?'Atlantis':'Oregon',year:2026,employment:'working'},reply:'Please confirm the state and year. Has your benefits team confirmed whether the role change changes your insurance?',proposedAction:'none',evidenceIds:[]},evidence:[]}});
  });
  await page.goto(base,{waitUntil:'networkidle'});await page.getByLabel('Use connected guru',{exact:true}).check();
  async function ask(text){await page.getByLabel('What would you like to work out?',{exact:true}).fill(text);await page.getByRole('button',{name:'Send to guru',exact:true}).click();await page.getByRole('button',{name:'Send to guru',exact:true}).waitFor();}
  await ask('Fictional scenario: I work in Oregon and am changing internal roles in 2026. Benefit terms and premiums are unknown. What should I verify first?');
  await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).waitFor();assert.equal(await page.getByLabel('State',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).click();assert.equal(await page.getByLabel('State',{exact:true}).inputValue(),'OR');assert.equal(await page.getByLabel('Coverage year',{exact:true}).inputValue(),'2026');
  assert.equal(await page.getByLabel('Annual household income ($)',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Employer insurance offer',{exact:true}).inputValue(),'unknown');
  passed.push('recognized full state name normalizes to its exact supported code, remains pending, and applies only on confirmation');
  mode='unavailable';
  await ask('Fictional scenario: I am changing internal roles. Benefit dates, terms and premiums are unknown. What should I verify first?');
  await page.getByRole('log').getByText(/first ask your benefits administrator/).waitFor();assert.equal(await page.getByRole('button',{name:'1 Discover',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('log').getByText(/Do both premium amounts cover/).count(),0);
  passed.push('unavailable connected turn provides transition/benefits guidance and keeps unknown amounts out of comparison');
  await ask('Compare the premiums for my new employer offer.');
  await page.getByRole('log').getByText(/What is the other option’s premium contribution/).waitFor();assert.equal(await page.getByLabel('Both amounts cover',{exact:true}).inputValue(),'unknown');
  passed.push('explicit comparison asks for missing contributions before same-people confirmation');
  mode='unknown-state';await ask('Fictional unsupported-location correction.');
  assert.equal(await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).count(),0);assert.equal(await page.getByLabel('State',{exact:true}).inputValue(),'OR');
  passed.push('unknown state suggestion fails closed and leaves confirmed state unchanged');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,synthetic:true,liveModelCalls:0,realUserArtifactsRead:false},null,2));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
