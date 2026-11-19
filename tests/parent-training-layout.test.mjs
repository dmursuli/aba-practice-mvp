import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const template=html.match(/<template id="parent-goal-template">([\s\S]*?)<\/template>/)[1];
const inline=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
test('Parent Training cards fit desktop, laptop and narrow viewports with ordered counters and usable actions',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage();
 await page.setContent(`<style>${css}\n${inline}</style><main class="parent-shell"><section class="parent-panel">${template}</section></main>`);
 await page.locator('[data-field="goalName"]').fill('Caregiver implements communication opportunities');
 await page.locator('[data-field="targetName"]').fill('Model and reinforce requests during daily routines');
 await page.locator('.parent-goal-row').evaluate(el=>el.classList.add('stagnant-target'));
 await page.locator('[data-parent-goal-review]').evaluate(el=>el.innerHTML='<div class="mastery-review-hint mastery-review-hint-stagnant">Stagnant: review recent progress.</div>');
 for(const width of [1440,1024,768,390,320]){
 await page.setViewportSize({width,height:1000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow at ${width}`);
 const prompted=await page.locator('[data-parent-goal-response="prompted"][data-response-step="1"]').boundingBox();
 const independent=await page.locator('[data-parent-goal-response="independent"][data-response-step="1"]').boundingBox();
 assert.ok(prompted.y<independent.y || prompted.x<independent.x,`prompted first at ${width}`);
 assert.ok(await page.locator('[data-mark-parent-goal-mastered]').isVisible());
 assert.equal(await page.locator('.parent-goal-row').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 }
 }finally{await browser.close();}
});
