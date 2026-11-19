import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {initializeNewProgramPhases,applyProgramClinicalAction} from '../lib/program-phase-workflow.mjs';
const read=file=>readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
const app=read('app.js');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];

test('BCBA phase controls save a zero probe, confirm transition and keep the active 97155 session',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  const actor={id:'bcba',role:'bcba',name:'Synthetic BCBA'};
  const context={clientId:'c',sessionId:'active97155',sessionDate:'2026-11-19'};
  const client={id:'c',programs:[{id:'p',name:'Synthetic program',targets:[{id:'a',name:'A'}]}],profile:{graphPhaseLines:{}},planChangeLog:[],note97155History:[]};
  const db={clients:[client],sessions:[]};
  let failNext=false;
  initializeNewProgramPhases(client,new Set(),context,new Date(Date.now()-1000).toISOString());
  await page.route('**/*',async route=>{
   if(route.request().url()!=='https://phase.test/action') return route.abort();
   if(failNext){failNext=false;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({errors:['Synthetic save failure']})});return;}
   try {const payload=route.request().postDataJSON();const result=applyProgramClinicalAction(db,'c','p',payload,actor,new Date(Date.now()+(payload.action==='start-treatment'?60000:0)).toISOString());await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});}
   catch(error){await route.fulfill({status:error.status || 500,contentType:'application/json',body:JSON.stringify({errors:[error.message]})});}
  });
  await page.setContent(`<style>${read('styles.css')}</style><main id="plan"></main><p id="message" role="status"></p>`);
  const source=read('graph-values.js')+'\n'+read('charts.js').replace(/^import .*;$/gm,'');
  await page.addScriptTag({type:'module',content:source+`
    let client=${JSON.stringify(client)};
    const state={active97155SessionId:'active97155',sessions:[]};
    const context=${JSON.stringify(context)};
    const currentClient=()=>client, currentPlanChangeDate=()=>context.sessionDate;
    let editable=true;const canEditClinical=()=>editable;
    const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const planMessage=document.querySelector('#message');
    const bcbaSessionForm={elements:{startTime:{value:'09:30'},endTime:{value:'11:30'},setting:{value:'clinic'}}};
    const persistCurrentPlanDraftBefore97155Generation=async()=>{};
    const current97155SessionContext=()=>context;
    const replaceClient=value=>client=value;
    const syncGraphPhaseLineState=()=>{};
    const recordProgramClinicalAction=async(c,p,payload)=>{
      const response=await fetch('https://phase.test/action',{method:'POST',body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw Error(result.errors.join(' '));return result;
    };
    ${extract('renderProgramPhaseControls')}
    ${extract('handleProgramClinicalAction')}
    const renderPlanReview=()=>document.querySelector('#plan').innerHTML=renderProgramPhaseControls(client.programs[0]);
    document.querySelector('#plan').addEventListener('click',event=>{const button=event.target.closest('[data-program-clinical-action]');if(button)void handleProgramClinicalAction(button);});
    window.snapshot=()=>({state,client});window.asRbt=()=>{editable=false;renderPlanReview();};
    renderPlanReview();
  `});
  await page.getByText('Current Phase: Baseline',{exact:true}).waitFor();
  let confirmations=0;page.on('dialog',async dialog=>{confirmations++;await dialog.accept();});
  await page.locator('[data-probe-value]').fill('0');
  await page.getByRole('button',{name:'Start Treatment',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Collect at least one baseline observation before beginning treatment.'}).waitFor();
  assert.equal(db.sessions.length,0);
  await page.locator('[data-probe-value]').fill('0');
  await page.getByRole('button',{name:'Save observation',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Observation saved.'}).waitFor();
  assert.equal(db.sessions[0].id,'active97155');assert.equal(client.note97155History.length,0);
  failNext=true;
  await page.getByRole('button',{name:'Start Treatment',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Synthetic save failure'}).waitFor();
  await page.getByText('Current Phase: Baseline',{exact:true}).waitFor();
  assert.equal(client.profile.graphPhaseLines['skill:p'].length,1);
  await page.getByRole('button',{name:'Start Treatment',exact:true}).click();
  await page.getByText('Current Phase: Treatment',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Start Treatment',exact:true}).count(),0);
  assert.equal((await page.evaluate(()=>snapshot())).state.active97155SessionId,'active97155');
  assert.equal(confirmations,3);
  await page.evaluate(()=>asRbt());assert.equal(await page.locator('[data-program-clinical-action]').count(),0);
  assert.equal(client.note97155History.length,0);
 } finally {await browser.close();}
});
