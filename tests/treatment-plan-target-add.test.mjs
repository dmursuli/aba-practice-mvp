import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {programPhaseAt} from '../public/charts.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, 'm'))[0];
function fixture({fail=false}={}) {
 let server={id:'c',programs:[{id:'p',name:'Program',domain:'Communication',targets:[]}],behaviors:[],planChangeLog:[],profile:{graphPhaseLines:{'skill:p':[{id:'treatment',date:'2026-01-01',label:'Treatment',phaseType:'environmental',clinicalPhase:'intervention',effectiveAt:'2026-01-01T09:00:00Z'}]}}};
 const state={activeClientId:'c',clients:[structuredClone(server)],active97155SessionId:'same-session',activePlanProgramTab:'paused',activePlanReviewFilter:'ready',activePlanDomain:'Other'};
 let saves=0,visible=[],reviewResolve,saveResolve;
 const reviewGate=new Promise(resolve=>reviewResolve=resolve), saveGate=new Promise(resolve=>saveResolve=resolve);
 const context=vm.createContext({state,structuredClone,window:{prompt:()=> 'New target'},planMessage:{textContent:''},
 currentClient:()=>state.clients[0],currentPlanDraft:()=>({programs:structuredClone(state.clients[0].programs),behaviors:[]}),
 clientDomains:()=>['Communication'],clientRbtPerformanceAreas:()=>[],dateInputValue:()=> '2026-11-19',currentPlanChangeDate:()=> '2026-11-19',
 current97155SessionContext:()=>({clientId:'c',sessionId:state.active97155SessionId,sessionDate:'2026-11-19'}),cryptoId:()=> 'new-change',slugify:()=> 'new-target',
 syncGraphPhaseLineState:()=>{},invalidateTargetReviews:()=>{},resetRows:()=>{},currentView:()=> 'plan',
 masteryReviewForTarget:()=>({state:'none'}),resolvePlanTargetMasteryDate:()=>'',
 ensureTargetReviewsLoaded:()=>reviewGate,
 updateClientPlan:async(id,payload)=>{saves++;await saveGate;if(fail)throw Error('Synthetic save failure');server={...server,...structuredClone(payload)};return structuredClone(server);}
 });
 const render=()=>{visible=state.clients[0].programs.filter(p=>p.domain===state.activePlanDomain).flatMap(p=>Array.from(context.filteredTargetsForPlanProgram(p,state.activePlanProgramTab),t=>t.name));};
 context.render=render;context.renderPlanReview=render;
 vm.runInContext(['handlePlanClick','savePlan','trackPlanSave','replaceClient','normalizePlanStatus','filteredTargetsForPlanProgram','targetMatchesPlanTab','targetMatchesPlanReviewFilter'].map(extract).join('\n'),context);
 const button={dataset:{addTarget:'p'},disabled:false};
 const event=()=>({target:{closest:selector=>selector==='[data-add-target]'?button:null}});
 return {context,state,button,click:()=>context.handlePlanClick(event()),server:()=>server,saves:()=>saves,visible:()=>visible,saveResolve,reviewResolve,render};
}

test('confirmed target appears immediately before review refresh completes; double click produces one target and phase stays Treatment',async()=>{
 const f=fixture();const phases=structuredClone(f.server().profile.graphPhaseLines);
 const first=f.click();await Promise.resolve();
 assert.equal(f.button.disabled,true);await f.click();assert.equal(f.saves(),1);
 assert.equal(f.state.clients[0].programs[0].targets.length,0);
 f.saveResolve();for(let i=0;i<8;i++)await Promise.resolve();
 assert.deepEqual(f.visible(),['New target'],'visible without waiting for target-review refresh');
 assert.equal(f.state.clients[0].programs[0].targets.length,1);
 assert.equal(f.state.active97155SessionId,'same-session');
 assert.deepEqual(f.state.clients[0].profile.graphPhaseLines,phases);
 assert.equal(programPhaseAt(phases['skill:p'],{x:'2026-11-19',recordedAt:'2026-11-19T10:00:00Z'}),'intervention');
 f.reviewResolve();await first;
 f.state.clients=[structuredClone(f.server())];f.render();
 assert.deepEqual(f.visible(),['New target']);assert.equal(f.server().programs[0].targets.length,1);
 assert.equal(f.button.disabled,false);
});

test('failed target save leaves persisted and local targets and filters unchanged, unlocks retry',async()=>{
 const f=fixture({fail:true});const before=structuredClone(f.state.clients);
 const pending=f.click();f.saveResolve();await pending;
 assert.deepEqual(f.state.clients,before);assert.equal(f.server().programs[0].targets.length,0);
 assert.equal(f.state.activePlanProgramTab,'paused');assert.equal(f.state.activePlanReviewFilter,'ready');
 assert.equal(f.button.disabled,false);assert.match(f.context.planMessage.textContent,/Synthetic save failure/);
});
