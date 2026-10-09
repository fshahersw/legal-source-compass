import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(path.join(process.env.ATLAS_BROWSER_TOOLING_ROOT ?? import.meta.dirname, 'package.json'));
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../../..');
const output=path.resolve(process.env.ATLAS_BROWSER_OUTPUT ?? path.join(root,'.verification/limitations'));
const evidenceRoot=path.resolve(process.env.LIM_BUNDLE_DIR ?? path.join(root,'private/data/limitations'));
const baseUrl=process.env.ATLAS_BASE_URL ?? 'http://127.0.0.1:5217';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({...(process.env.ATLAS_BROWSER_CHANNEL ? {channel:process.env.ATLAS_BROWSER_CHANNEL}:{}),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[],checks=[];const cache=new Map();
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/api/bundles?**',async route=>{
 const url=new URL(route.request().url()),name=url.searchParams.get('file');
 if(!name?.startsWith('limitations/')||name.includes('..'))return route.continue();
 if(!cache.has(name))cache.set(name,await readFile(path.join(evidenceRoot,name.slice('limitations/'.length))));
 const b=cache.get(name),p=Number(url.searchParams.get('page')??0),size=256*1024,sha=createHash('sha256').update(b).digest('hex');
 await route.fulfill({status:200,headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Atlas-Snapshot-Sha256':sha,'X-Atlas-Snapshot-Bytes':String(b.length),'X-Atlas-Page':String(p),'X-Atlas-Page-Count':String(Math.ceil(b.length/size))},body:b.subarray(p*size,Math.min(b.length,(p+1)*size))});
});
const factor=id=>page.locator(`[id="factor-${id}"]`);
async function confirmTimeline(){
 for(const text of ["I checked that this state's limitations law governs this claim.",'I checked the legally relevant start dates under the cited rule.','I checked this claim category and statutory version against the facts.'])await page.getByRole('checkbox',{name:text}).check();
 await page.getByRole('button',{name:'Continue to review'}).click();
}
async function completeUnanswered(){
 for(const group of ['screening','tolling','scope','authority']){
  const section=page.getByTestId(`review-group-${group}`);if(!(await section.count()))continue;
  const toggle=section.getByRole('button').first();if((await toggle.getAttribute('aria-expanded'))!=='true')await toggle.click();
  const bulk=section.getByRole('button',{name:/Mark \d+ unanswered as checked/});if(await bulk.isEnabled())await bulk.click();
 }
}
try{
 await page.goto(baseUrl+'/limitations?state=CA&claim=personal_injury',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByTestId('guided-calculator').waitFor({timeout:60000});
 await page.getByRole('button',{name:'Continue to timeline'}).click();
 await page.locator('#guided-date-accrualDate').fill('2024-01-01');await confirmTimeline();
 await factor('screen:disability').getByRole('combobox').selectOption('needs_review');
 await completeUnanswered();
 await page.getByRole('button',{name:'Assess deadline',exact:true}).click();
 const result=page.getByTestId('guided-result');await result.waitFor();
 assert((await result.innerText()).toLowerCase().includes('no deadline established'));checks.push('Unresolved factor withholds date and survives bulk acknowledgement');
 await page.getByRole('button',{name:'Needs attention',exact:true}).click();
 assert.equal(await page.getByTestId('review-factor').count(),1);
 const remainingGroup=page.getByTestId('review-group-screening');
 const remainingToggle=remainingGroup.getByRole('button').first();
 if(await remainingToggle.getAttribute('aria-expanded')!=='true')await remainingToggle.click();
 assert.equal(await remainingGroup.getByRole('button',{name:/Mark \d+ unanswered as checked/}).isDisabled(),true);
 await page.getByRole('button',{name:'Next unresolved factor',exact:true}).click();
 await page.waitForFunction(()=>document.activeElement?.id==='factor-screen:disability');
 await page.getByRole('searchbox',{name:'Search factors and citations',exact:true}).fill('no-such-factor-xyz');
 assert.equal(await page.getByTestId('review-factor').count(),0);
 assert((await result.innerText()).toLowerCase().includes('no deadline established'));
 await page.getByRole('button',{name:'Show all factors',exact:true}).click();
 checks.push('Unresolved-only filtering and keyboard focus preserve the blocking factor; search cannot hide a requirement from calculation');
 const screen=page.getByTestId('review-group-screening').getByRole('button').first();if((await screen.getAttribute('aria-expanded'))!=='true')await screen.click();
 await factor('screen:disability').getByRole('combobox').selectOption('no_effect');
 await page.getByRole('button',{name:'Assess deadline',exact:true}).click();
 assert((await result.innerText()).includes('Jan 1, 2026'));checks.push('Real California ordinary personal-injury baseline uses the loaded two-year rule');
 await page.getByRole('button',{name:'Statutes & sources',exact:true}).click();
 await page.getByRole('button',{name:'Calculator',exact:true}).click();
 assert.equal(await page.getByTestId('guided-result').count(),1,'The source-view round trip must preserve the current in-memory assessment');
 assert((await page.getByTestId('guided-result').innerText()).includes('Jan 1, 2026'));
 checks.push('Reading source material and returning does not erase dates, review or results');

 await page.getByRole('button',{name:'2. Timeline',exact:true}).click();
 await page.locator('#guided-date-accrualDate').fill('2024-02-02');
 assert.equal(await page.getByRole('checkbox',{name:'I checked the legally relevant start dates under the cited rule.'}).isChecked(),false);
 assert.equal(await result.count(),0);checks.push('Date change clears prior result and date-specific confirmations');
 await page.locator('#guided-date-accrualDate').fill('2024-01-01');await confirmTimeline();
 await factor('screen:tolling').getByRole('combobox').first().selectOption('instruction');
 const editor=factor('screen:tolling').getByTestId('instruction-editor');
 await editor.getByLabel(/First excluded day/).fill('2024-03-01');
 await editor.getByLabel(/First day the clock runs again/).fill('2024-04-01');
 await editor.getByLabel('Authority or case document',{exact:true}).fill('Synthetic UI regression agreement, clause 1 (not an actual legal authority)');
 await editor.getByLabel('Why this effect applies',{exact:true}).fill('Synthetic regression scenario only. The entered effect is a test assumption, not an assertion about an actual claim or a statute.');
 await editor.getByLabel('Reviewed by',{exact:true}).fill('Automated browser test');
 for (const name of ['I checked the legal effect and its applicability to this claim, party and statutory version.','I checked the dates and exactly which boundary days count.','I checked prior expiry, other tolls, exclusions, and any independent outer bar.']) await editor.getByRole('checkbox',{name,exact:true}).check();
 await completeUnanswered();
 await page.getByRole('button',{name:'Calculate reviewed scenario',exact:true}).click();
 await result.waitFor();const text=await result.innerText();
 assert(text.toLowerCase().includes('reviewed scenario date'));assert(text.includes('Feb 1, 2026'));assert(text.includes('Original baseline: Jan 1, 2026'));assert(text.includes('31'));
 checks.push('Reviewed 31-day synthetic suspension retains the original baseline and labels the scenario conditional');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export full assessment',exact:true}).click();const download=await downloadPromise;const file=path.join(output,'browser-assessment-export.json');await download.saveAs(file);const exported=JSON.parse(await readFile(file,'utf8'));
 assert.equal(exported.coverage.exhaustiveLegalReview,false);assert.equal(exported.coverage.verifiedFilingDeadline,false);assert.equal(exported.assessment.date,'2026-02-01');assert(exported.sourceReferences.every(s=>/^[a-f0-9]{64}$/.test(s.sha256)));checks.push('JSON export contains immutable source fingerprints and never claims a verified final filing date');
 const capGroup=page.getByTestId('review-group-screening').getByRole('button').first();
 if(await capGroup.getAttribute('aria-expanded')!=='true')await capGroup.click();
 await editor.getByRole('checkbox',{name:'This authority limits the excluded interval',exact:true}).check();
 await editor.getByLabel('Maximum period',{exact:true}).fill('10');
 await editor.getByLabel('Maximum period unit',{exact:true}).selectOption('calendar_days');
 for (const name of ['I checked the legal effect and its applicability to this claim, party and statutory version.','I checked the dates and exactly which boundary days count.','I checked prior expiry, other tolls, exclusions, and any independent outer bar.']) await editor.getByRole('checkbox',{name,exact:true}).check();
 await page.getByRole('button',{name:'Calculate reviewed scenario',exact:true}).click();
 assert((await result.innerText()).includes('Jan 11, 2026'));
 assert((await result.innerText()).includes('Excluded days counted once: 10'));
 checks.push('An expressly entered 10-day suspension maximum reduces the earlier 31-day scenario without changing the original baseline');
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.waitForTimeout(200);
 await page.screenshot({path:path.join(output,'guided-instruction-desktop.png'),fullPage:true});
 if(await capGroup.getAttribute('aria-expanded')==='true')await capGroup.click();
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:path.join(output,'guided-result-desktop.png'),fullPage:true});
 const desktopAxe=await new AxeBuilder({page}).include('[data-testid="guided-calculator"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'guided-result-mobile.png'),fullPage:true});
 const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));assert(width.scroll<=width.viewport);checks.push('390px mobile layout has no horizontal page overflow');
 const mobileAxe=await new AxeBuilder({page}).include('[data-testid="guided-calculator"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 const violations=[...desktopAxe.violations.map(v=>({viewport:'desktop',id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>n.target)})),...mobileAxe.violations.map(v=>({viewport:'mobile',id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>n.target)}))];
 const report={checkedAt:new Date().toISOString(),checks,errors,accessibilityViolations:violations,caseData:'Synthetic browser regression scenario; real hash-verified legal release .8'};
 await writeFile(path.join(output,'browser-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 assert.equal(errors.length,0);assert.equal(violations.length,0);
}catch(error){await page.screenshot({path:path.join(output,'browser-verification-error.png'),fullPage:true});console.log('BROWSER_FAILURE',String(error));console.log((await page.locator('body').innerText()).slice(-7000));process.exitCode=1;}
finally{await browser.close();}
