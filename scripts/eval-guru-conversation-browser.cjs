/** Real browser/application flow; synthetic HTTP + model replies, zero paid calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.AFFINITY_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.AFFINITY_EVAL_APP_URL;assert.equal(new URL(base).hostname,'127.0.0.1');
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.AFFINITY_TEST_BROWSER_CHANNEL?{channel:process.env.AFFINITY_TEST_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[],requests=[],passed=[];page.on('pageerror',e=>errors.push(e.message));
 const sourceDate=new Date(Date.now()-86400000).toISOString();let turn=0;
 const key=(a,c)=>JSON.stringify(a==='network'?[c.state,c.zip,c.year,c.householdSize,c.npi,c.planIdType,c.planId]:[c.state,c.zip,c.year,c.age,c.income,c.householdSize,c.employerOffer]);
 const evidence=(a,c)=>({id:'current-'+a,action:a,requestKey:key(a,c),observedAt:new Date().toISOString(),title:a==='network'?'Listed in the issuer file':'Synthetic Marketplace route',facts:a==='network'?[{label:'Source',value:'SYNTHETIC_REVIEW_FIXTURE'},{label:'Source date',value:sourceDate},{label:'Evidence status',value:'listed'}]:[{label:'Coverage year',value:String(c.year)}],notes:['Synthetic evidence. Confirm exact option and effective year with official sources.']});
 try{
  await page.route('**/api/providers/autocomplete',r=>r.fulfill({json:{items:[{npi:'1234567890',name:'Dr Morgan Sample',specialty:'Synthetic family medicine'}]}}));
  await page.route('**/api/tic/plans?*',r=>r.fulfill({json:{items:[{planIdType:'ein',planId:'111111111',planName:'Synthetic Example Plan',issuer:'Synthetic Issuer'}]}}));
  await page.route('**/api/eligibility',r=>{const c=r.request().postDataJSON();return r.fulfill({json:{year:c.year,verdict:'marketplace',headline:'Synthetic Marketplace route',nextSteps:['Confirm through the official Marketplace.']}});});
  await page.route('**/api/tic/verify',r=>{const c=r.request().postDataJSON();return r.fulfill({json:{npi:c.npi,plan:{idType:c.planIdType,id:c.planId},value:'yes',source:'SYNTHETIC_REVIEW_FIXTURE',sourceUpdated:sourceDate,evidenceStatus:'listed',explanation:'Synthetic dated listing; confirm exact option and effective year.'}});});
  await page.route('**/api/guru',r=>{
   const b=r.request().postDataJSON();requests.push(b);turn++;
   const fresh=b.evidenceActions.map(a=>evidence(a,b.context));
   const replies={
    1:{step:'discover',reply:'Which state do you need coverage in?'},
    2:{step:'discover',reply:'Please confirm these details, then I can check your routes.',changes:{state:'OH',zip:'44113',age:'35',income:'30000',employerOffer:'none'},proposedAction:'screen'},
    3:{step:'coverage',reply:'The screening suggests a Marketplace route, with official eligibility still to confirm. What is your doctor’s name?',evidenceIds:['current-screen']},
    4:{step:'coverage',reply:'Confirm the doctor search name, then choose the matching record.',changes:{doctorQuery:'Dr Morgan Sample'}},
    5:{step:'coverage',reply:'Dr Morgan Sample is selected. What is the plan or employer’s name?'},
    6:{step:'coverage',reply:'The doctor and plan are selected. Shall I check this pair?',proposedAction:'network'},
    7:{step:'coverage',reply:'The dated issuer fixture lists this doctor. Confirm the exact benefit option and effective year before relying on that listing. [current-network]',evidenceIds:['current-network']},
    8:{step:'coverage',reply:'The file describes its source date; it does not promise next-year coverage. Ask the insurer and doctor to confirm the exact option for your coverage year.',evidenceIds:['current-network']},
    9:{step:'discover',reply:'Please confirm household size 2. Earlier household-dependent results will need a new check.',changes:{householdSize:'2'}},
   };
   assert.ok(replies[turn],'Unexpected model turn '+turn);
   return r.fulfill({json:{mode:'connected',reply:{changes:{},proposedAction:'none',evidenceIds:[],...replies[turn]},evidence:fresh}});
  });
  await page.goto(base,{waitUntil:'networkidle'});await page.getByLabel('Use connected guru',{exact:true}).check();
  async function ask(text){await page.getByLabel('What would you like to work out?',{exact:true}).fill(text);await page.getByRole('button',{name:'Send to guru',exact:true}).click();await page.getByRole('button',{name:'Send to guru',exact:true}).waitFor();}
  await ask('I lost coverage and need help.');await page.getByText('Which state do you need coverage in?',{exact:true}).waitFor();
  await ask('Ohio, ZIP 44113, age 35, income 30000, no employer offer.');
  await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).waitFor();assert.equal(await page.getByLabel('State',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).click();
  await page.getByRole('button',{name:'Confirm and run: Check coverage routes',exact:true}).click();
  await page.getByText('The screening suggests a Marketplace route, with official eligibility still to confirm. What is your doctor’s name?',{exact:true}).waitFor();
  assert.equal(requests[2].context.zip,'44113');assert.ok(requests[2].history.some(m=>m.text.includes('Ohio')));assert.deepEqual(requests[2].evidenceActions,['screen']);
  passed.push('initial free text → one missing-field question → confirmed context → confirmed real tool handler → sourced explanation');
  await ask('My doctor is Dr Morgan Sample.');await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).click();
  await page.getByRole('option').filter({hasText:'Dr Morgan Sample'}).click();
  await page.getByText('Dr Morgan Sample is selected. What is the plan or employer’s name?',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Or find your plan by name',exact:true}).fill('Example');await page.getByRole('option').filter({hasText:'Synthetic Example Plan'}).click();
  await page.getByRole('button',{name:'Confirm and run: Check this doctor and plan',exact:true}).click();
  await page.getByText('The dated issuer fixture lists this doctor. Confirm the exact benefit option and effective year before relying on that listing. issuer evidence',{exact:true}).waitFor();
  assert.equal(requests[6].context.npi,'1234567890');assert.equal(requests[6].context.planId,'111111111');
  const positive=page.locator('.guru-message').filter({hasText:'The dated issuer fixture lists this doctor.'});assert.equal(await positive.getAttribute('data-superseded'),'false');
  assert.ok(await positive.locator('a[data-evidence-id="current-network"]').count());assert.ok(!(await positive.innerText()).includes('[current-network]'));
  passed.push('doctor and plan name search → explicit match selection → confirmed care-fit check, without requiring the user to know identifiers');
  await ask('Why can’t you guarantee next year?');await page.getByText('The file describes its source date; it does not promise next-year coverage. Ask the insurer and doctor to confirm the exact option for your coverage year.',{exact:true}).waitFor();
  assert.ok(requests[7].history.some(m=>m.text.includes('dated issuer fixture')));assert.ok(requests[7].evidenceActions.includes('network'));
  fs.mkdirSync('tmp/guru-demo',{recursive:true});await page.screenshot({path:'tmp/guru-demo/conversation-evidence.png',fullPage:true});
  passed.push('follow-up carries history, confirmed context and applicable evidence without retelling the story');
  await ask('Correction: household size 2.');await page.getByRole('button',{name:'Confirm suggested edits',exact:true}).click();
  assert.equal(await positive.getAttribute('data-superseded'),'true');assert.equal(await positive.locator('a').count(),0);assert.equal(await page.getByRole('heading',{name:'Listed in the issuer file',exact:true}).count(),0);
  passed.push('confirmed conversational correction visibly supersedes old chat claims and removes old evidence cards');
  await page.getByLabel('Use connected guru',{exact:true}).uncheck();
  await page.getByRole('button',{name:'3 Compare',exact:true}).click();
  await page.getByLabel('Employer employee contribution ($)',{exact:true}).fill('100');await page.getByLabel('Marketplace monthly premium ($)',{exact:true}).fill('200');await page.getByLabel('Both amounts cover',{exact:true}).selectOption('self');
  await page.getByRole('button',{name:'Compare declared premiums',exact:true}).click();await page.getByRole('heading',{name:'Premium comparison—not total care cost',exact:true}).waitFor();
  await page.getByRole('button',{name:'1 Discover',exact:true}).click();await page.getByLabel('People in your household',{exact:true}).fill('3');
  await page.getByRole('button',{name:'3 Compare',exact:true}).click();assert.equal(await page.getByLabel('Both amounts cover',{exact:true}).inputValue(),'unknown');
  await page.getByLabel('Both amounts cover',{exact:true}).selectOption('household');
  await page.getByRole('navigation',{name:'Primary',exact:true}).getByRole('link',{name:'Compare',exact:true}).click();
  await page.getByLabel('People in household',{exact:true}).fill('4');
  await page.getByRole('navigation',{name:'Primary',exact:true}).getByRole('link',{name:'guru',exact:true}).click();
  await page.getByRole('button',{name:'3 Compare',exact:true}).click();assert.equal(await page.getByLabel('Both amounts cover',{exact:true}).inputValue(),'unknown');
  assert.ok(await page.getByRole('log').getByText('Why can’t you guarantee next year?',{exact:true}).count());
  passed.push('all tested household write paths reset same-people premium basis; conversation survives navigation');
  fs.mkdirSync('tmp/guru-demo',{recursive:true});await page.screenshot({path:'tmp/guru-demo/conversation-wide.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'tmp/guru-demo/conversation-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(turn,9);console.log(JSON.stringify({passed,mockedModelTurns:turn,liveModelCalls:0,liveSourceCalls:0,synthetic:true},null,2));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
