import test from 'node:test';
import assert from 'node:assert/strict';
import {applyProgramClinicalAction,programPhaseRecords,validateManagedPhaseEdit} from '../lib/program-phase-workflow.mjs';
import {buildGraphAnalysis,programPhaseAt} from '../public/charts.js';
import {sanitizeCustomPhaseLines} from '../public/report-utils.js';
import {sanitizeClinicalSnapshot} from '../public/report-snapshot.js';
const context={clientId:'c',sessionId:'active97155',sessionDate:'2026-11-19',startTime:'09:30',endTime:'11:30'};
function fixture(){
 const client={id:'c',programs:[{id:'p',targets:[{id:'t'}]}],profile:{graphPhaseLines:{}},planChangeLog:[],note97155History:[]};
 const sessions=Array.from({length:10},(_,i)=>({id:`s${i}`,clientId:'c',date:`2025-01-${String(i+1).padStart(2,'0')}`,soapNote:'Preserve',programs:[{programId:'p',targets:[{id:`o${i}`,targetId:'t',independence:i*10}]}]}));
 const db={clients:[client],sessions};
 const points=sessions.map(s=>({x:s.date,y:s.programs[0].targets[0].independence}));
 const analysis=()=>buildGraphAnalysis([{name:'T',points}],{phaseMarkers:programPhaseRecords(client,'p')}).analyses[0];
 const act=(extra={},role='bcba')=>applyProgramClinicalAction(db,'c','p',{action:'classify-historical',boundaryMode:'first',baselineBefore:false,confirmed:true,sessionContext:context,...extra},{id:'clinician',role},'2026-11-19T15:00:00.000Z');
 return {db,client,points,analysis,act};
}
test('ten historical observations identify absent classification without fabricated analytics',()=>{
 const {analysis}=fixture();const a=analysis();
 assert.equal(a.treatmentLevel,null);assert.equal(a.baselineLevel,null);assert.equal(a.currentLevel,90);
 assert.equal(a.phaseUnclassified,true);assert.match(a.interpretation,/Treatment phase not established for historical data/);
 assert.doesNotMatch(a.interpretation,/insufficient/i);assert.equal(a.trendDirection,'Phase not established');
});
test('confirmed first-observation decision computes treatment analytics and preserves every stored observation',()=>{
 const {db,client,analysis,act}=fixture();const before=JSON.stringify(db.sessions);
 act();const a=analysis();assert.equal(a.treatmentLevel,45);assert.equal(a.trendDirection,'Increasing');assert.equal(a.currentLevel,90);
 assert.equal(a.baselineLevel,null);assert.equal(a.recentPerformance,'Recent improvement');
 assert.equal(JSON.stringify(db.sessions),before);assert.deepEqual(client.note97155History,[]);
 const record=programPhaseRecords(client,'p')[0];assert.equal(record.date,'2025-01-01');assert.equal(record.decidedBy,'clinician');assert.equal(record.decidedAt,'2026-11-19T15:00:00.000Z');
 assert.throws(()=>act(),/already has/);
 const clean=sanitizeCustomPhaseLines(client.profile.graphPhaseLines);
 validateManagedPhaseEdit(client,clean);
 const snapshot=sanitizeClinicalSnapshot({version:1,phases:{'skill:p':{phaseMarkers:[record]}}});
 for(const field of ['historicalDecision','baselineBefore','decidedBy','decidedAt']) assert.equal(snapshot.phases['skill:p'].phaseMarkers[0][field],record[field]);
});
for(const baselineBefore of [false,true]) test(`later boundary explicitly controls earlier Baseline=${baselineBefore}`,()=>{
 const {db,client,points,analysis,act}=fixture();const before=JSON.stringify(db.sessions);
 act({boundaryMode:'date',startDate:'2025-01-06',baselineBefore});
 assert.deepEqual(points.map(p=>programPhaseAt(programPhaseRecords(client,'p'),p)),Array(5).fill(baselineBefore?'baseline':null).concat(Array(5).fill('intervention')));
 assert.equal(analysis().baselineLevel,baselineBefore?20:null);assert.equal(analysis().treatmentLevel,70);
 assert.equal(JSON.stringify(db.sessions),before);
});
test('permission, confirmation, eligible date and program/client isolation reject without mutation',()=>{
 for(const [payload,role] of [[{},'rbt'],[{confirmed:false},'bcba'],[{boundaryMode:'date',startDate:'2024-01-01'},'bcba'],[{baselineBefore:undefined},'bcba']]) {
  const {db,act}=fixture();const before=structuredClone(db);assert.throws(()=>act(payload,role));assert.deepEqual(db,before);
 }
 const {db,act}=fixture();db.sessions.forEach(s=>s.programs[0].programId='other');
 db.sessions.push({clientId:'other-client',date:'2024-01-01',programs:[{programId:'p',targets:[{targetId:'t',independence:0}]}]});
 const before=structuredClone(db);assert.throws(()=>act(),/No eligible/);assert.deepEqual(db,before);
});
test('established treatment with fewer than three valid observations is insufficient; baseline alone is not',()=>{
 const {act,analysis}=fixture();act({boundaryMode:'date',startDate:'2025-01-09'});assert.equal(analysis().trendDirection,'Insufficient data');
 const a=buildGraphAnalysis([{name:'T',points:[{x:'2025-01-01',y:0}]}],{phaseMarkers:[{date:'2025-01-01',label:'Baseline',phaseType:'environmental'}]}).analyses[0];
 assert.equal(a.trendDirection,'Treatment not started');assert.doesNotMatch(a.interpretation,/insufficient/i);
});

test('actual UI handler requires confirmation, preserves session, and immediately updates phase analysis',async()=>{
 const {readFileSync}=await import('node:fs');const {default:vm}=await import('node:vm');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
 for(const mode of ['first','date']) {
  const f=fixture();let accepted=false,calls=0,rendered=false;
  const section={querySelector:s=>s==='[data-history-date]'?{value:'2025-01-06'}:s==='[data-history-baseline]'?{checked:true}:null};
  const button={dataset:{programClinicalAction:'classify-historical',programId:'p',boundaryMode:mode},disabled:false,closest:()=>section};
  const sandbox={canEditClinical:()=>true,window:{confirm:()=>accepted},persistCurrentPlanDraftBefore97155Generation:async()=>{},current97155SessionContext:()=>context,
   bcbaSessionForm:{elements:{startTime:{value:'09:30'},endTime:{value:'11:30'},setting:{value:'clinic'}}},currentClient:()=>f.client,
   recordProgramClinicalAction:async(c,p,payload)=>{calls++;return f.act(payload);},replaceClient:()=>{},syncGraphPhaseLineState:()=>{},
   state:{sessions:[],active97155SessionId:context.sessionId},renderPlanReview:()=>{rendered=true;},planMessage:{}};
  vm.createContext(sandbox);vm.runInContext(extract('handleProgramClinicalAction')+'\nthis.actUI=handleProgramClinicalAction;',sandbox);
  await sandbox.actUI(button);assert.equal(calls,0);assert.equal(f.analysis().phaseUnclassified,true);
  accepted=true;await sandbox.actUI(button);assert.equal(calls,1);assert.equal(rendered,true);
  assert.equal(f.analysis().treatmentLevel,mode==='first'?45:70);assert.equal(sandbox.state.active97155SessionId,context.sessionId);
  assert.equal(button.disabled,false);
 }
});
