import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
function setup(){
 const sandbox={state:{activePlanReviewFilter:'',activePlanProgramTab:'active'},
  masteryReviewForTarget:(p,t)=>({state:t==='ready'?'ready':'none'}),activeStagnantTarget:(p,t)=>t.id==='stagnant',
  resolvePlanTargetMasteryDate:()=>'',escapeHtml:String,clientDomains:()=>['General'],
  normalizeSkillDataCollectionType:()=> 'percent_correct',renderProgramPhaseControls:p=>`<div data-phase-program="${p.id}">Phase controls</div>`,
  planStatusTabs:{innerHTML:'',querySelectorAll:()=>[]}};
 vm.createContext(sandbox);
 vm.runInContext(['normalizePlanStatus','programMatchesPlanTab','programHasPlanContentForTab','targetMatchesPlanTab','targetMatchesPlanReviewFilter','filteredTargetsForPlanProgram','renderPlanStatusTabs','renderPlanProgram'].map(extract).join('\n'),sandbox);
 return sandbox;
}
for(const [status,children] of [['active',['mastered','mastered']],['active',['paused','mastered']],['paused',['active','mastered']],['mastered',['active','paused']]]) {
 test(`${status} program with ${children} targets remains in its own tab with empty target state and controls`,()=>{
  const s=setup(),program={id:'p',name:'Program',status,targets:children.map((status,i)=>({id:`t${i}`,status}))};
  const before=structuredClone(program);
  for(const tab of ['active','paused','mastered']) assert.equal(s.programHasPlanContentForTab(program,tab),tab===status);
  assert.equal(s.filteredTargetsForPlanProgram(program,status).length,0);
  const html=s.renderPlanProgram(program,status);
  assert.match(html,/No targets in this status view/);
  for(const attr of ['data-phase-program','data-open-plan-graph','data-add-target','data-plan-program-status','data-program-name','data-program-objective']) assert.ok(html.includes(attr));
  assert.doesNotMatch(html,/data-target-anchor/);
  assert.deepEqual(program,before);
 });
}
test('target rows retain independent status filtering and do not mutate target order',()=>{
 const s=setup(),p={id:'p',status:'paused',targets:['active','paused','mastered'].map(status=>({id:status,status}))};
 const before=structuredClone(p);
 for(const tab of ['active','paused','mastered']) assert.deepEqual(Array.from(s.filteredTargetsForPlanProgram(p,tab),t=>t.id),[tab]);
 assert.deepEqual(p,before);
});
test('review filters can cross program status but still hide programs with no matching targets',()=>{
 const s=setup();
 const p={id:'p',status:'paused',targets:[{id:'ready',status:'active'}]};
 s.state.activePlanReviewFilter='ready';
 assert.equal(s.programHasPlanContentForTab(p,'active'),true);
 assert.equal(s.programHasPlanContentForTab({...p,targets:[{id:'other',status:'active'}]},'active'),false);
 s.state.activePlanReviewFilter='stagnant';
 assert.equal(s.programHasPlanContentForTab(p,'paused'),false);
 assert.equal(s.programHasPlanContentForTab({...p,targets:[{id:'stagnant'}]},'paused'),true);
});
test('program status tab counts are parent-based, including while a review filter is active',()=>{
 const s=setup();
 const programs=[{status:'active',targets:[{status:'mastered'}]},{status:'active',targets:[{status:'paused'}]},
  {status:'paused',targets:[{status:'active'}]},{status:'mastered',targets:[]}];
 const before=structuredClone(programs);
 for(const filter of ['', 'ready']) {
  s.state.activePlanReviewFilter=filter;s.renderPlanStatusTabs(programs);
  assert.match(s.planStatusTabs.innerHTML,/Active goals \(2\)/);
  assert.match(s.planStatusTabs.innerHTML,/On hold \(1\)/);
  assert.match(s.planStatusTabs.innerHTML,/Mastered goals \(1\)/);
 }
 assert.deepEqual(programs,before);
 const review=extract('renderPlanReview');
 assert.match(review,/activePrograms = programs\.filter\(\(program\) => programMatchesPlanTab\(program, "active"\)\)/);
 assert.match(review,/activeTargets = programs\.flatMap\(\(program\) => program\.targets \|\| \[\]\)\.filter/);
 assert.match(review,/pausedTargets = programs\.flatMap\(\(program\) => program\.targets \|\| \[\]\)\.filter/);
 assert.match(review,/const masteryCounts = masteryReviewCounts\(\)/);
});
