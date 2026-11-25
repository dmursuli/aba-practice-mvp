import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
function graphSetup(scope){
 let client={id:'c'},fetches=0,resolveFetch;
 const sessions=[{id:'old',clientId:'c',date:'2025-01-01'}];
 const button={dataset:{openPlanGraph:'p'},disabled:false};
 const state={activeClientId:'c',sessionsLoadedScope:scope,sessionsLoadedClientId:'c',sessions:['client','all'].includes(scope)?sessions:[],sessionsLoadError:''};
 const opened=[];
 const sandbox={state,currentClient:()=>client,rerenderSessionBackedView:()=>{},planMessage:{textContent:''},
  getClientSessions:async()=>{fetches++;return await new Promise(resolve=>resolveFetch=resolve);},
  openProgramGraphModal:id=>opened.push({id,sessions:state.sessions})};
 vm.createContext(sandbox);vm.runInContext(['ensureClientSessionsLoaded','handlePlanClick'].map(extract).join('\n'),sandbox);
 const click=()=>sandbox.handlePlanClick({target:{closest:selector=>selector==='[data-open-plan-graph]'?button:null}});
 return {sandbox,button,state,opened,click,sessions,fetches:()=>fetches,finish:value=>resolveFetch(value),switchClient:()=>client={id:'other'}};
}
for(const scope of ['none','clientRange','clientPage','client','all']) test(`normal program graph waits for full history from ${scope} scope`,async()=>{
 const f=graphSetup(scope),pending=f.click();
 if(!['client','all'].includes(scope)) {
  assert.equal(f.opened.length,0);assert.equal(f.button.disabled,true);
  await f.click();assert.equal(f.fetches(),1);
  f.finish({sessions:f.sessions});
 }
 await pending;
 assert.equal(f.fetches(),['client','all'].includes(scope)?0:1);
 assert.equal(f.opened.length,1);assert.equal(f.opened[0].id,'p');
 assert.equal(f.button.disabled,false);
 assert.deepEqual(f.opened[0].sessions,f.sessions);
});
test('client switch during graph loading prevents opening the previous client modal',async()=>{
 const f=graphSetup('none'),pending=f.click();f.switchClient();f.finish({sessions:f.sessions});await pending;
 assert.equal(f.opened.length,0);assert.equal(f.button.disabled,false);
});
test('loader error is displayed without opening an empty graph',async()=>{
 const f=graphSetup('none');f.sandbox.getClientSessions=async()=>{throw Error('History unavailable');};
 await f.click();assert.equal(f.opened.length,0);assert.equal(f.sandbox.planMessage.textContent,'History unavailable');assert.equal(f.button.disabled,false);
});
function navigation(){
 const programs=['active','paused','mastered','mastered'].map((status,i)=>({id:`p${i}`,name:`Program ${i}`,status,domain:`Domain ${i}`,targets:[{id:`t${i}`,name:`Target ${i}`,status:'mastered'}]}));
 function tabs(attribute){return {innerHTML:'',querySelectorAll(){return [...this.innerHTML.matchAll(new RegExp(`${attribute}="([^"]+)"`,'g'))].map(([,value])=>({dataset:{[attribute==='data-plan-status-tab'?'planStatusTab':'planDomainTab']:value},addEventListener:(event,fn)=>{this[value]=fn;}}));}};}
 const sandbox={state:{activePlanProgramTab:'active',activePlanReviewFilter:'',activePlanDomain:'Domain 0'},
  currentClient:()=>({name:'Client',programs}),clientPrograms:()=>programs,clientBehaviors:()=>[],clientDomains:()=>programs.map(p=>p.domain),
  masteryReviewForTarget:()=>({state:'mastered'}),activeStagnantTarget:()=>false,masteryReviewCounts:()=>({mastered:4,ready:0,close:0,stagnant:0}),
  targetReviewCacheEntry:()=>({status:'ready'}),resolvePlanTargetMasteryDate:()=>'',resolvePlanProgramMasteryDate:()=>'',
  escapeHtml:String,normalizeSkillDataCollectionType:()=> 'percent_correct',renderProgramPhaseControls:()=>'',masteryReviewClass:()=>'',formatMasteryDate:String,renderMasteryReviewHint:()=>'',
  groupedProgramsByDomain:ps=>ps.map(p=>[p.domain,[p]]),renderHistoricalTargets:()=>'',renderPlanBehaviorSection:()=>'',bindPlanReviewInputs:()=>{},
  planStatusTabs:tabs('data-plan-status-tab'),planDomainTabs:tabs('data-plan-domain-tab'),planClientSummary:{innerHTML:''},
  planReview:{innerHTML:'',insertAdjacentHTML(){},querySelector:()=>null},planMessage:{}};
 vm.createContext(sandbox);
 vm.runInContext(['normalizePlanStatus','programMatchesPlanTab','programHasPlanContentForTab','targetMatchesPlanTab','targetMatchesPlanReviewFilter','filteredTargetsForPlanProgram','renderPlanStatusTabs','renderPlanDomainTabs','renderPlanProgram','renderPlanReview','jumpToReviewState'].map(extract).join('\n'),sandbox);
 return {s:sandbox,programs};
}
test('Mastered programs navigation lists every mastered program and repairs stale domain selection',()=>{
 const {s,programs}=navigation(),before=structuredClone(programs);s.renderPlanReview();
 s.planStatusTabs.mastered();
 assert.equal(s.state.activePlanProgramTab,'mastered');assert.equal(s.state.activePlanDomain,'Domain 2');
 assert.match(s.planStatusTabs.innerHTML,/Mastered programs \(2\)/);
 assert.match(s.planReview.innerHTML,/data-program-name="p2"/);assert.match(s.planReview.innerHTML,/data-program-name="p3"/);
 assert.doesNotMatch(s.planReview.innerHTML,/data-program-name="p0"|data-program-name="p1"/);
 s.planDomainTabs['Domain 3']();assert.equal(s.state.activePlanDomain,'Domain 3');
 assert.match(s.planReview.innerHTML,/class="plan-domain " data-plan-domain="Domain 3"/);
 s.planStatusTabs.paused();assert.equal(s.state.activePlanDomain,'Domain 1');
 assert.deepEqual(programs,before);
});
test('Mastered targets review spans all program statuses and domains independently of the program tab',()=>{
 const {s,programs}=navigation(),before=structuredClone(programs);s.renderPlanReview();s.jumpToReviewState('mastered');
 assert.equal(s.state.activePlanProgramTab,'active');assert.equal(s.state.activePlanReviewFilter,'mastered');
 assert.match(s.planReview.innerHTML,/Mastered targets \(4\)/);
 for(let i=0;i<4;i++) {
  assert.ok(s.planReview.innerHTML.includes(`data-target-anchor="p${i}:t${i}"`));
  assert.ok(s.planReview.innerHTML.includes(`class="plan-domain " data-plan-domain="Domain ${i}"`));
 }
 assert.equal(s.planDomainTabs.innerHTML,'');
 s.planStatusTabs.mastered();assert.equal(s.state.activePlanReviewFilter,'');
 assert.deepEqual(programs,before);
});
