import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {historicalTargetInventory} from '../lib/historical-targets.mjs';
import {buildTargetReviewSummary} from '../lib/target-review.mjs';
import {applyProgramClinicalAction,programPhaseRecords} from '../lib/program-phase-workflow.mjs';
import {clinicalPhaseOf,programPhaseAt} from '../public/charts.js';
import {buildSkillMeasurementChart} from '../public/skill-graph-measurements.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
function fixture(){
 const client={id:'c',programs:[{id:'p',name:'Configured program',targets:[{id:'active',name:'Shared name',status:'active'}]}],profile:{},planChangeLog:[]};
 const session=(id,date)=>({id,clientId:'c',date,serviceType:'97153',programs:[
  {programId:'p',targets:[{targetId:'active',independence:90},{targetId:'old',targetName:'Shared name',independence:0}]},
  {programId:'removed',programName:'Original program',targets:[{targetId:'old',targetName:'Removed target',independence:60}]}
 ]});
 const sessions=[session('s1','2026-01-01'),session('s2','2026-01-02')];
 return {client,sessions};
}
test('compact inventory deduplicates by saved program/target IDs without touching configured reviews or data',()=>{
 const {client,sessions}=fixture(),before=structuredClone({client,sessions});
 const summary=buildTargetReviewSummary(client,sessions);
 assert.deepEqual(summary.historicalPrograms.map(p=>[p.id,p.name,p.targets]),[
  ['p','Configured program',[{id:'old',name:'Shared name'}]],['removed','Original program',[{id:'old',name:'Removed target'}]]
 ]);
 assert.deepEqual(summary.historicalPrograms[0].historicalDates,['2026-01-01','2026-01-02']);
 assert.equal(summary.targets.length,1);assert.equal(summary.targets[0].targetId,'active');
 const activeOnly=sessions.map(s=>({...s,programs:[{programId:'p',targets:[s.programs[0].targets[0]]}]}));
 assert.deepEqual(summary.counts,buildTargetReviewSummary(client,activeOnly).counts);
 assert.doesNotMatch(JSON.stringify(summary),/"soapNote"|"sessions"|"independence"|"therapist"/);
 assert.deepEqual({client,sessions},before);
});
test('inventory requires eligible numeric observations and saved IDs and isolates clients',()=>{
 const {client,sessions}=fixture();
 const base=sessions[0];
 const invalid=[null,'',undefined,NaN,-1,101];
 const entries=invalid.map((independence,i)=>({targetId:`bad${i}`,independence}));
 entries.push({targetId:'p',independence:30},{independence:30},{targetId:'ambiguous',frequency:2});
 const bad={...base,programs:[{programId:'p',targets:entries}]};
 assert.deepEqual(historicalTargetInventory(client,[bad,{...base,clientId:'other'},{...base,deleted:true}]),[]);
 assert.deepEqual(historicalTargetInventory(client,[{...bad,programs:[{programId:'p',targets:[{targetId:'freq',frequency:0,dataCollectionType:'frequency'}]}]}])[0].targets,[{id:'freq',name:'freq'}]);
});
test('removed program supports one program-wide historical decision but never becomes an active program',()=>{
 const {client,sessions}=fixture(),db={clients:[client],sessions};
 const before=structuredClone({programs:client.programs,sessions});
 const context={clientId:'c',sessionId:'note',sessionDate:'2026-11-24'};
 applyProgramClinicalAction(db,'c','removed',{action:'classify-historical',boundaryMode:'first',baselineBefore:false,confirmed:true,sessionContext:context},{id:'bcba',role:'bcba'});
 const records=programPhaseRecords(client,'removed');
 assert.equal(records.length,1);assert.equal(records[0].date,'2026-01-02');
 assert.equal(programPhaseAt(records,{x:'2026-01-01'}),'baseline');
 assert.equal(programPhaseAt(records,{x:'2026-01-02'}),'intervention');
 assert.equal(client.planChangeLog[0].programId,'removed');
 assert.equal(client.planChangeLog[0].programName,'Original program');
 assert.deepEqual({programs:client.programs,sessions},before);
 for(const action of ['save-observation','establish-baseline','start-treatment']) assert.throws(()=>applyProgramClinicalAction(db,'c','removed',{action,sessionContext:context},{role:'bcba'}),/Program not found/);
});
test('historical UI exposes read-only names, graph access and program controls without session hydration',async()=>{
 const {client,sessions}=fixture();
 const snapshot=buildTargetReviewSummary(client,sessions);
 const sandbox={targetReviewCacheEntry:()=>({status:'ready',snapshot}),state:{historicalPhaseProgramId:'removed'},
  currentClient:()=>client,currentPlanChangeDate:()=>'2026-11-24',canEditClinical:()=>true,escapeHtml:String,formatGraphDate:String,
  clinicalPhaseOf,programPhaseAt,currentSessions:()=>{throw Error('No hydration permitted');}};
 vm.createContext(sandbox);
 vm.runInContext(['historicalProgramsForPlan','renderHistoricalTargets','renderHistoricalPhaseControls','renderProgramPhaseControls'].map(extract).join('\n'),sandbox);
 const html=sandbox.renderHistoricalTargets();
 assert.match(html,/Historical targets/);assert.match(html,/Original program/);assert.match(html,/Historical \/ not currently active/);
 assert.match(html,/data-open-historical-graph="removed"/);assert.match(html,/data-boundary-mode="first"/);
 assert.doesNotMatch(html,/data-probe-target|data-add-target|data-target-status|data-program-name|data-review-jump/);
 assert.equal((html.match(/data-phase-program="removed"/g)||[]).length,1);
 assert.doesNotMatch(extract('ensureTargetReviewsLoaded'),/getClientSessions|ensureClientSessionsLoaded|state\.sessions/);
 sandbox.targetReviewCacheEntry=()=>({status:'ready',snapshot:{historicalPrograms:[]}});
 assert.equal(sandbox.renderHistoricalTargets(),'');
});
test('existing shared chart builder can graph an inventory program without restoring it to the plan',()=>{
 const {client,sessions}=fixture();const historical=historicalTargetInventory(client,sessions)[1];
 const sandbox={configuredTargetsForProgram:p=>p.targets,buildSkillMeasurementChart,graphObservationProvider:()=>'',
  targetEntries:s=>s.programs.flatMap(p=>p.targets.map(t=>({...t,programId:p.programId}))),isActualTargetEntry:t=>Boolean(t.targetId),
  state:{activeClientId:'c',skillGraphMeasurements:{}}};
 vm.createContext(sandbox);vm.runInContext(extract('buildProgramSkillChart'),sandbox);
 const before=structuredClone({client,sessions});
 const chart=sandbox.buildProgramSkillChart(historical,sessions);
 assert.equal(chart.series.length,1);assert.deepEqual(Array.from(chart.series[0].points,p=>p.y),[60,60]);
 assert.deepEqual({client,sessions},before);
});

test('historical review and classification use the compact inventory without loading sessions or saving an active plan',async()=>{
 const {client,sessions}=fixture(),db={clients:[client],sessions};
 const before=structuredClone({programs:client.programs,sessions});
 const context={clientId:'c',sessionId:'draft',sessionDate:'2026-11-24'};
 const section={dataset:{historicalOnly:'true'},querySelector:()=>null};
 const button={dataset:{programClinicalAction:'review-history',programId:'removed'},disabled:false,closest:()=>section};
 let rendered=0,calls=0;
 const sandbox={canEditClinical:()=>true,currentClient:()=>client,state:{historicalPhaseProgramId:'',sessions:[]},
  ensureClientSessionsLoaded:()=>{throw Error('Unexpected hydration');},
  persistCurrentPlanDraftBefore97155Generation:()=>{throw Error('Unexpected active plan save');},
  renderPlanReview:()=>rendered++,window:{confirm:()=>true},current97155SessionContext:()=>context,
  bcbaSessionForm:{elements:{startTime:{value:'09:00'},endTime:{value:'10:00'},setting:{value:'clinic'}}},
  recordProgramClinicalAction:async(c,p,payload)=>{calls++;return applyProgramClinicalAction(db,c,p,payload,{id:'bcba',role:'bcba'});},
  replaceClient:()=>{},syncGraphPhaseLineState:()=>{},planMessage:{textContent:''}};
 vm.createContext(sandbox);vm.runInContext(extract('handleProgramClinicalAction'),sandbox);
 await sandbox.handleProgramClinicalAction(button);
 assert.equal(sandbox.state.historicalPhaseProgramId,'removed');assert.equal(rendered,1);
 button.dataset={programClinicalAction:'classify-historical',programId:'removed',boundaryMode:'first'};
 await sandbox.handleProgramClinicalAction(button);
 assert.equal(calls,1);assert.equal(rendered,2);assert.match(sandbox.planMessage.textContent,/Program phase saved/);
 assert.deepEqual({programs:client.programs,sessions},before);
});

test('historical graph loads session data only after an explicit graph action',async()=>{
 const {client}=fixture();let loads=0,opened;
 const button={dataset:{openHistoricalGraph:'removed'},disabled:false};
 const sandbox={currentClient:()=>client,ensureClientSessionsLoaded:async()=>loads++,
  openProgramGraphModal:(...args)=>opened=args,planMessage:{}};
 vm.createContext(sandbox);vm.runInContext(extract('handlePlanClick'),sandbox);
 await sandbox.handlePlanClick({target:{closest:selector=>selector==='[data-open-historical-graph]'?button:null}});
 assert.equal(loads,1);assert.deepEqual(opened,['removed',true]);assert.equal(button.disabled,false);
});
