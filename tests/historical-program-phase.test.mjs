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
test('confirmed first-date Baseline decision computes treatment analytics and preserves every stored observation',()=>{
 const {db,client,analysis,act}=fixture();const before=JSON.stringify(db.sessions);
 act();const a=analysis();assert.equal(a.treatmentLevel,50);assert.equal(a.trendDirection,'Increasing');assert.equal(a.currentLevel,90);
 assert.equal(a.baselineLevel,0);assert.equal(a.recentPerformance,'Recent improvement');
 assert.equal(JSON.stringify(db.sessions),before);assert.deepEqual(client.note97155History,[]);
 const record=programPhaseRecords(client,'p')[0];assert.equal(record.date,'2025-01-02');assert.equal(record.baselineBefore,true);assert.equal(record.decidedBy,'clinician');assert.equal(record.decidedAt,'2026-11-19T15:00:00.000Z');
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
  assert.equal(f.analysis().treatmentLevel,mode==='first'?50:70);assert.equal(sandbox.state.active97155SessionId,context.sessionId);
  assert.equal(button.disabled,false);
 }
});

test('one historical program decision updates all twelve targets without per-target records or observation writes',()=>{
 const {db,client,act}=fixture();
 client.programs[0].targets=Array.from({length:12},(_,i)=>({id:`t${i}`,name:`Target ${i}`}));
 db.sessions.forEach((session,i)=>{session.programs[0].targets=client.programs[0].targets
  .filter((target,j)=>j<11 || i>=8).map(target=>({id:`${session.id}-${target.id}`,targetId:target.id,independence:i*10}));});
 const before=JSON.stringify(db.sessions);act();
 assert.equal(programPhaseRecords(client,'p').length,1);
 assert.deepEqual(Object.keys(client.profile.graphPhaseLines),['skill:p']);
 for (const target of client.programs[0].targets) {
  const points=db.sessions.flatMap(s=>s.programs[0].targets.filter(p=>p.targetId===target.id).map(p=>({x:s.date,y:p.independence})));
  const result=buildGraphAnalysis([{name:target.name,points}],{phaseMarkers:programPhaseRecords(client,'p')}).analyses[0];
  assert.equal(result.treatmentLevel,target.id==='t11'?85:50);assert.equal(result.currentLevel,90);
  assert.equal(result.baselineLevel,target.id==='t11'?null:0);
  if(target.id==='t11') {assert.equal(result.trendDisplay,'Insufficient Treatment data for trend.');assert.match(result.trendConfidence,/Insufficient Treatment data/);}
  else {assert.equal(result.trendDirection,'Increasing');assert.equal(result.recentPerformance,'Recent improvement');}
 }
 assert.equal(JSON.stringify(db.sessions),before);
});

test('historical phase controls belong to Treatment Planning program and are absent from graph and report analysis',async()=>{
 const {readFileSync}=await import('node:fs');const {default:vm}=await import('node:vm');
 const {historicalProgramDates}=await import('../public/skill-graph-measurements.js');
 const {clinicalPhaseOf}=await import('../public/charts.js');
 const {buildCompactGraphAnalysisSentence}=await import('../public/report-utils.js');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
 const f=fixture();
 const sandbox={state:{historicalPhaseProgramId:'p'},currentClient:()=>f.client,currentSessions:()=>f.db.sessions,
  currentPlanChangeDate:()=>context.sessionDate,canEditClinical:()=>true,escapeHtml:String,formatGraphDate:String,
  clinicalPhaseOf,programPhaseAt,historicalProgramDates,buildCompactGraphAnalysisSentence};
 vm.createContext(sandbox);
 vm.runInContext(['renderHistoricalPhaseControls','renderProgramPhaseControls','renderGraphAnalysisMarkup','renderReportGraphAnalysisMarkup','renderGraphMetricCell','formatAnalysisMetric'].map(extract).join('\n'),sandbox);
 const markup=sandbox.renderProgramPhaseControls(f.client.programs[0]);
 assert.equal((markup.match(/data-boundary-mode="first"/g)||[]).length,1);
 assert.match(markup,/program-level decision applies to every target/);
 assert.match(markup,/Use first historical date as Baseline/);
 assert.match(markup,/All observations on the earliest recorded date will be Baseline/);
 assert.match(markup,/Treatment will begin immediately afterward/);
 const originalSessions=f.db.sessions;
 f.db.sessions=[originalSessions[0]];
 const singleDateMarkup=sandbox.renderProgramPhaseControls(f.client.programs[0]);
 assert.doesNotMatch(singleDateMarkup,/data-boundary-mode="first"[^>]*disabled/);
 assert.doesNotMatch(singleDateMarkup,/At least two historical observation dates are required/);
 assert.match(singleDateMarkup,/Establish Baseline going forward/);
 assert.match(singleDateMarkup,/data-boundary-mode="date"/);
 f.db.sessions=originalSessions;
 const analysis={graphType:'skill',analyses:[f.analysis()]};
 // Analyze the actual renderer source: no graph owns a historical action.
 for(const name of ['renderGraphAnalysisMarkup','renderReportGraphAnalysisMarkup']) assert.doesNotMatch(extract(name),/data-manage-historical-phase|data-program-clinical-action/);
 assert.equal((extract('renderPlanProgram').match(/renderProgramPhaseControls\(program\)/g)||[]).length,1);
 f.act();assert.doesNotMatch(sandbox.renderProgramPhaseControls(f.client.programs[0]),/data-boundary-mode/);
 assert.equal(buildCompactGraphAnalysisSentence({...f.analysis(),trendDisplay:'Insufficient Treatment data for trend.'},'skill').includes('Insufficient Treatment data for trend.'),true);
 sandbox.canEditClinical=()=>false;f.client.profile.graphPhaseLines={};
 assert.doesNotMatch(sandbox.renderProgramPhaseControls(f.client.programs[0]),/data-program-clinical-action/);
});

test('first-date mode groups all targets and timestamps by unique eligible date and appends provenance',()=>{
 const {db,client,act}=fixture();
 db.sessions=[
  {id:'late',clientId:'c',date:'2026-07-16',programs:[{programId:'p',targets:[{targetId:'a',independence:90}]}]},
  ...['2026-07-06','2026-07-09'].flatMap(date=>['00:01','23:59'].map((time,i)=>({
   id:`${date}-${i}`,clientId:'c',date,recordedAt:`${date}T${time}:00Z`,
   programs:[{programId:'p',targets:['a','b'].map(targetId=>({targetId,independence:i*20,recordedAt:`${date}T${time}:00Z`}))}]
  }))),
  {id:'invalid',clientId:'c',date:'2026-07-01',programs:[{programId:'p',targets:[{targetId:'a',independence:null}]}]}
 ];
 client.profile.graphPhaseLines['skill:p']=[{id:'annotation',date:'2026-07-01',label:'Context',phaseType:'environmental'}];
 client.planChangeLog=[{id:'earlier-change',note:'Preserve'}];
 const before=structuredClone(db);
 act();
 const records=programPhaseRecords(client,'p');
 assert.equal(records.length,2);
 assert.deepEqual(records[0],before.clients[0].profile.graphPhaseLines['skill:p'][0]);
 assert.equal(records[1].date,'2026-07-09');
 assert.equal(records[1].historicalDecision,true);
 assert.equal(records[1].baselineBefore,true);
 assert.equal(records[1].sessionId,context.sessionId);
 assert.equal(records[1].decidedBy,'clinician');
 assert.equal(records[1].decidedAt,'2026-11-19T15:00:00.000Z');
 assert.equal(client.planChangeLog.length,2);
 assert.deepEqual(client.planChangeLog[0],before.clients[0].planChangeLog[0]);
 for(const session of db.sessions.filter(s=>s.id!=='invalid')) {
  for(const point of session.programs[0].targets) {
   assert.equal(programPhaseAt(records,{...point,x:session.date}),session.date==='2026-07-06'?'baseline':'intervention');
  }
 }
 assert.deepEqual(db.sessions,before.sessions);
});

test('one unique historical date establishes Treatment after Baseline without fabricating observations',()=>{
 const {db,client,act}=fixture();
 db.sessions.forEach((session,i)=>{
  session.date='2026-07-06';
  if(i%2) session.programs[0].targets[0].recordedAt=`2026-07-06T${String(i).padStart(2,'0')}:00:00Z`;
 });
 client.planChangeLog=[{id:'existing',note:'Preserve'}];
 const before=structuredClone(db);
 act();
 const records=programPhaseRecords(client,'p'),record=records[0];
 assert.equal(records.length,1);
 assert.equal(record.date,'2026-07-06');
 assert.equal(record.effectiveAt,record.decidedAt);
 assert.equal(record.decidedAt,'2026-11-19T15:00:00.000Z');
 assert.equal(record.decidedBy,'clinician');
 assert.equal(record.historicalDecision,true);
 assert.equal(record.baselineBefore,true);
 assert.equal(client.planChangeLog.length,2);
 assert.deepEqual(client.planChangeLog[0],before.clients[0].planChangeLog[0]);
 const points=db.sessions.flatMap(s=>s.programs[0].targets.map(p=>({...p,x:s.date,y:p.independence})));
 assert.ok(points.every(point=>programPhaseAt(records,point)==='baseline'));
 assert.equal(programPhaseAt(records,{x:context.sessionDate,recordedAt:record.decidedAt}),'intervention');
 assert.equal(programPhaseAt(records,{x:'2026-11-20'}),'intervention');
 const analysis=buildGraphAnalysis([{name:'T',points}],{phaseMarkers:records}).analyses[0];
 assert.equal(analysis.baselineLevel,45);
 assert.equal(analysis.treatmentLevel,null);
 const clean=sanitizeCustomPhaseLines(client.profile.graphPhaseLines);
 validateManagedPhaseEdit(client,clean);
 const snapshot=sanitizeClinicalSnapshot({version:1,phases:{'skill:p':{phaseMarkers:records}}});
 assert.equal(snapshot.phases['skill:p'].phaseMarkers[0].effectiveAt,record.effectiveAt);
 assert.deepEqual(db.sessions,before.sessions);
 assert.deepEqual(client.note97155History,before.clients[0].note97155History);
});

test('one-date classification immediately permits Treatment observations without Start Treatment',()=>{
 const {db,client,act}=fixture();
 db.sessions=db.sessions.slice(0,1);
 // Even when the sole historical date is today's clinical date, existing
 // date-only observations remain Baseline and new observations link to Treatment.
 db.sessions[0].date=context.sessionDate;
 const history=structuredClone(db.sessions);
 act();
 const records=programPhaseRecords(client,'p');
 assert.equal(programPhaseAt(records,{x:context.sessionDate,recordedAt:records[0].decidedAt}),'intervention');
 assert.equal(programPhaseAt(records,{x:context.sessionDate}),'baseline');
 applyProgramClinicalAction(db,'c','p',{action:'save-observation',targetId:'t',value:60,sessionContext:context},
  {id:'clinician',role:'bcba'},'2026-11-19T15:01:00.000Z');
 assert.deepEqual(db.sessions[0],history[0]);
 const point=db.sessions[1].programs[0].targets[0];
 assert.equal(point.phase,'intervention');
 assert.equal(point.phaseRecordId,records[0].id);
 assert.equal(programPhaseAt(records,{...point,x:context.sessionDate}),'intervention');
 assert.equal(programPhaseRecords(client,'p').length,1);
});
