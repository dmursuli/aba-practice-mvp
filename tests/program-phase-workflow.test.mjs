import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {applyProgramClinicalAction,initializeNewProgramPhases,hasProgramBaseline,programPhaseRecords,BASELINE_REQUIRED} from '../lib/program-phase-workflow.mjs';
import {programPhaseAt,buildGraphAnalysis} from '../public/charts.js';
import {buildSkillMeasurementChart} from '../public/skill-graph-measurements.js';
import {planChangesFor97155Session,summarize97155TargetChanges,format97155TargetChangeSummary} from '../public/soap.js';
import {sanitizeCustomPhaseLines} from '../public/report-utils.js';
import {sanitizeClinicalSnapshot} from '../public/report-snapshot.js';
const actor={id:'bcba',role:'bcba',name:'Synthetic clinician'};
const context={clientId:'c',sessionId:'active97155',sessionDate:'2026-11-19',startTime:'09:30',endTime:'11:30'};
const time=minute=>`2026-11-19T14:${minute}:00.000Z`;
function fixture(){
 const client={id:'c',programs:[{id:'p',name:'Program',dataCollectionType:'percent_correct',targets:[{id:'a',name:'A'}]}],profile:{graphPhaseLines:{}},planChangeLog:[],note97155History:[]};
 const db={clients:[client],sessions:[]};
 initializeNewProgramPhases(client,new Set(),context,time('30'));
 return {db,client,act:(action,extra={},minute='35')=>applyProgramClinicalAction(db,'c','p',{action,sessionContext:context,...extra},actor,time(minute))};
}
function series(db,client){return [{name:'A',points:db.sessions.flatMap(session=>session.programs.flatMap(p=>p.targets.map(point=>({...point,x:session.date,y:point.independence}))))}];}

test('new program starts Baseline; repeated data collection never automatically starts Treatment',()=>{
 const {db,client,act}=fixture();
 const initial=structuredClone(client.profile.graphPhaseLines);
 initializeNewProgramPhases(client,new Set(),context,time('31'));
 assert.deepEqual(client.profile.graphPhaseLines,initial);
 assert.equal(programPhaseAt(programPhaseRecords(client,'p'),{x:context.sessionDate,recordedAt:time('31')}),'baseline');
 act('save-observation',{targetId:'a',value:0});act('save-observation',{targetId:'a',value:20},'36');
 const result=buildGraphAnalysis(series(db,client),{phaseMarkers:programPhaseRecords(client,'p')}).analyses[0];
 assert.equal(result.baselineLevel,10);assert.equal(result.treatmentLevel,null);assert.equal(result.currentLevel,null);
 assert.equal(db.sessions.length,1);assert.equal(db.sessions[0].id,context.sessionId);
 assert.equal(client.note97155History.length,0);assert.equal(programPhaseRecords(client,'p').length,1);
});

test('baseline gate rejects absent and missing-only values, accepts zero, and respects program/client isolation',()=>{
 const {db,client,act}=fixture();
 assert.throws(()=>act('start-treatment'),new RegExp(BASELINE_REQUIRED));
 for(const value of [null,undefined,'',' ',NaN]) assert.throws(()=>act('save-observation',{targetId:'a',value}),/valid observation/);
 db.sessions.push({id:'missing',clientId:'c',date:context.sessionDate,programs:[{programId:'p',targets:[{targetId:'a',independence:null,recordedAt:time('32')}]}]});
 db.sessions.push({id:'other',clientId:'c',date:context.sessionDate,programs:[{programId:'other',targets:[{independence:0,recordedAt:time('32')}]}],behaviors:[{frequency:0}]});
 db.sessions.push({id:'other-client',clientId:'other',date:context.sessionDate,programs:[{programId:'p',targets:[{independence:0,recordedAt:time('32')}]}]});
 assert.equal(hasProgramBaseline(db,client,'p'),false);
 assert.throws(()=>act('start-treatment'),new RegExp(BASELINE_REQUIRED));
 act('save-observation',{targetId:'a',value:0});act('start-treatment',{},'45');
 assert.equal(programPhaseAt(programPhaseRecords(client,'p'),{x:context.sessionDate,recordedAt:time('46')}),'intervention');
 assert.throws(()=>act('start-treatment',{},'47'),/only while/);
});

test('same-session baseline, transition, later target and cumulative SOAP regeneration retain persisted evidence',()=>{
 const {db,client,act}=fixture();
 act('save-observation',{targetId:'a',value:0});
 const baseline=structuredClone(db.sessions[0].programs[0].targets[0]);
 act('start-treatment',{},'45');
 client.programs[0].targets.push({id:'b',name:'B'});
 client.planChangeLog.push({id:'add',clientId:'c',sessionId:context.sessionId,type:'target-added',programId:'p',programName:'Program',targetId:'b',targetName:'B'});
 act('save-observation',{targetId:'b',value:60},'50');
 assert.deepEqual(db.sessions[0].programs[0].targets[0],baseline);
 const points=series(db,client)[0].points;
 assert.deepEqual(points.map(point=>programPhaseAt(programPhaseRecords(client,'p'),point)),['baseline','intervention']);
 assert.equal(db.sessions.length,1);assert.equal(db.sessions[0].id,context.sessionId);
 const note=()=>format97155TargetChangeSummary(summarize97155TargetChanges(planChangesFor97155Session(client.planChangeLog,context)));
 assert.match(note(),/Baseline probe.*0%/);assert.match(note(),/Baseline → Treatment/);assert.match(note(),/Targets introduced.*B/);
 client.planChangeLog.push({id:'modify',clientId:'c',sessionId:context.sessionId,type:'target-modified',programId:'p',programName:'Program',targetId:'b',targetName:'B',field:'note',toValue:'New protocol'});
 assert.match(note(),/Baseline probe/);assert.match(note(),/Baseline → Treatment/);assert.match(note(),/Targets modified/);
 assert.equal(client.note97155History.length,0,'SOAP has not created clinical state or an automatic draft');
});

test('legacy programs remain untouched; explicit Maintenance and Generalization are authoritative',()=>{
 for(const phase of ['Maintenance','Generalization']) {
  const {db,client,act}=fixture();client.profile.graphPhaseLines['skill:p']=[{id:'legacy',date:'2025-01-01',phaseType:'environmental',label:phase}];
  const before=structuredClone(db);
  initializeNewProgramPhases(client,new Set(['p']),context);
  assert.equal(programPhaseAt(programPhaseRecords(client,'p'),{x:context.sessionDate}),phase.toLowerCase());
  assert.throws(()=>act('start-treatment'),/only while/);assert.deepEqual(db,before);
 }
 const {db,client,act}=fixture();client.profile.graphPhaseLines={};
 const before=structuredClone(db);initializeNewProgramPhases(client,new Set(['p']),context);
 assert.deepEqual(db,before);assert.equal(programPhaseAt([], {x:context.sessionDate}),null);
 act('establish-baseline');
 assert.equal(programPhaseAt(programPhaseRecords(client,'p'),{x:'2026-11-18'}),null);
 assert.equal(programPhaseAt(programPhaseRecords(client,'p'),{x:context.sessionDate}),null,'unknown same-day historical timing is not guessed');
});

test('role and closed-note protections reject without mutation',()=>{
 const {db,act}=fixture();const before=structuredClone(db);
 for(const role of ['rbt','caregiver']) assert.throws(()=>applyProgramClinicalAction(db,'c','p',{action:'start-treatment',sessionContext:context},{...actor,role}),/authorized/);
 assert.deepEqual(db,before);
 db.clients[0].note97155History.push({id:context.sessionId,date:context.sessionDate,status:'finalized'});
 assert.throws(()=>act('save-observation',{targetId:'a',value:0}),/closed/);
});

test('new timed phase metadata survives graph editor and report snapshot round trips',()=>{
 const {client,act}=fixture();act('save-observation',{targetId:'a',value:0});act('start-treatment',{},'45');
 const stored=client.profile.graphPhaseLines;
 const clean=sanitizeCustomPhaseLines(stored);
 for(let i=0;i<2;i++) assert.equal(clean['skill:p'][i].effectiveAt,stored['skill:p'][i].effectiveAt);
 const snapshot=sanitizeClinicalSnapshot({version:1,phases:{'skill:p':{phaseMarkers:stored['skill:p']}}});
 assert.equal(snapshot.phases['skill:p'].phaseMarkers[0].initial,true);
 assert.equal(snapshot.phases['skill:p'].phaseMarkers[1].effectiveAt,time('45'));
});

test('actual UI action keeps active session ID, requires confirmation, and sends observations before SOAP generation',async()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
 const {db,client}=fixture();const state={active97155SessionId:context.sessionId,sessions:[]};let confirms=0;
 const ctx=vm.createContext({state,canEditClinical:()=>true,window:{confirm:()=>{confirms++;return true;}},
 persistCurrentPlanDraftBefore97155Generation:async()=>{},current97155SessionContext:()=>context,
 bcbaSessionForm:{elements:{startTime:{value:'09:30'},endTime:{value:'11:30'},setting:{value:'clinic'}}},
 currentClient:()=>client,replaceClient:()=>{},syncGraphPhaseLineState:()=>{},renderPlanReview:()=>{},planMessage:{textContent:''},
 recordProgramClinicalAction:async(c,p,payload)=>applyProgramClinicalAction(db,c,p,payload,actor,payload.action==='save-observation'?time('35'):time('45'))});
 vm.runInContext(extract('handleProgramClinicalAction'),ctx);
 const button=action=>({dataset:{programClinicalAction:action,programId:'p'},disabled:false,closest:()=>({querySelector:selector=>({value:selector==='[data-probe-target]'?'a':'0'})})});
 await ctx.handleProgramClinicalAction(button('save-observation'));
 assert.equal(db.sessions[0].id,context.sessionId);assert.equal(client.note97155History.length,0);
 await ctx.handleProgramClinicalAction(button('start-treatment'));
 assert.equal(confirms,1);assert.equal(state.active97155SessionId,context.sessionId);
 assert.equal(client.planChangeLog.length,2);
});

test('09:35 Baseline → 09:45 Start Treatment → 10:00 Treatment stays ordered within one session/date',()=>{
 const {db,client}=fixture();
 const save=(action,at,value)=>applyProgramClinicalAction(db,'c','p',{action,sessionContext:context,targetId:'a',value},actor,`2026-11-19T${at}:00.000Z`);
 // Use UTC instants corresponding to 09:35, 09:45 and 10:00 Eastern.
 save('save-observation','14:35',0);save('start-treatment','14:45');save('save-observation','15:00',60);
 const points=series(db,client)[0].points;
 const records=programPhaseRecords(client,'p');
 assert.deepEqual(points.map(point=>programPhaseAt(records,point)),['baseline','intervention']);
 assert.equal(db.sessions.length,1);assert.equal(db.sessions[0].id,context.sessionId);
 // Input order cannot make the older point become Current Level.
 const analysis=buildGraphAnalysis([{name:'A',points:[...points].reverse()}],{phaseMarkers:records}).analyses[0];
 assert.equal(analysis.baselineLevel,0);assert.equal(analysis.treatmentLevel,60);assert.equal(analysis.currentLevel,60);
});

test('persisted out-of-range percentages and invalid frequency counts cannot satisfy the baseline gate',()=>{
 for (const [dataCollectionType,field,value] of [['percent_correct','independence',101],['percent_correct','independence',-1],['frequency','frequency',-1],['frequency','frequency',1.5]]) {
  const {db,client,act}=fixture();
  db.sessions.push({id:'invalid',clientId:'c',date:context.sessionDate,programs:[{programId:'p',targets:[{targetId:'a',dataCollectionType,[field]:value,recordedAt:time('32')}]}]});
  assert.equal(hasProgramBaseline(db,client,'p'),false);
  assert.throws(()=>act('start-treatment'),new RegExp(BASELINE_REQUIRED));
 }
});

test('actual graph builder retains every same-target probe and later targets have no invented baseline',()=>{
 const {db,client,act}=fixture();
 act('save-observation',{targetId:'a',value:0});act('save-observation',{targetId:'a',value:20},'36');act('start-treatment',{},'45');
 client.programs[0].targets.push({id:'b',name:'B'});
 act('save-observation',{targetId:'b',value:60},'50');act('save-observation',{targetId:'a',value:70},'51');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const ctx=vm.createContext({buildSkillMeasurementChart,configuredTargetsForProgram:p=>p.targets,graphObservationProvider:()=>actor.name,isActualTargetEntry:p=>!!p.targetId,state:{activeClientId:'c',skillGraphMeasurements:{}}});
 vm.runInContext(app.match(/^function buildProgramSkillChart\([^\n]*\{[\s\S]*?^}/m)[0],ctx);
 const chart=ctx.buildProgramSkillChart(client.programs[0],db.sessions);
 const analyses=buildGraphAnalysis(chart.series,{phaseMarkers:programPhaseRecords(client,'p')}).analyses;
 assert.equal(chart.series[0].points.length,3);
 assert.equal(analyses[0].baselineLevel,10);assert.equal(analyses[0].treatmentLevel,70);
 assert.equal(analyses[1].baselineLevel,null);assert.equal(analyses[1].treatmentLevel,60);
 assert.equal(programPhaseRecords(client,'p').length,2);
});

test('real Generate → continue → regenerate handlers retain one draft and cumulative final-status narrative',async()=>{
 const {db,client,act}=fixture();
 act('save-observation',{targetId:'a',value:0});act('start-treatment',{},'45');
 client.programs[0].targets.push({id:'b',name:'B'});
 const log=extra=>client.planChangeLog.push({id:String(client.planChangeLog.length),...context,programId:'p',programName:'Program',targetId:'b',targetName:'B',...extra});
 log({type:'target-added'});log({type:'target-status-changed',toStatus:'active'});
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
 const state={active97155SessionId:context.sessionId,currentUser:actor};
 const sessionDetails={date:context.sessionDate,startTime:'09:30',endTime:'11:30',setting:'clinic',rbtPresent:false,providerSignature:'Synthetic',providerCredential:'BCBA'};
 const ctx=vm.createContext({structuredClone,state,planChangesFor97155Session,summarize97155TargetChanges,format97155TargetChangeSummary,
 currentClient:()=>client,currentPlanChangeDate:()=>context.sessionDate,
 bcbaSessionForm:{elements:{startTime:{value:'09:30'}}},readBcbaSessionDetails:()=>sessionDetails,
 soapEntryStatus:({record})=>record?.status || 'finalized',cryptoId:()=>{throw Error('must retain active ID');},
 note97155Status:{textContent:''},note97155Editor:{value:''},planMessage:{textContent:''},
 refreshCurrentClientPlanBefore97155Generation:async()=>{},persistCurrentPlanDraftBefore97155Generation:async()=>{},confirmRegenerateNote:()=>true,
 currentPrograms:()=>client.programs,clientPrograms:()=>client.programs,clientBehaviors:()=>[],clientDomains:()=>[],clientRbtPerformanceAreas:()=>[],
 formatDate:String,signatureBlock:()=>'',renderHistory:()=>{},renderNote:()=>{},renderSoapSummary:()=>{},
 savePlan:async(programs,behaviors,change,note,domains,rbt,note51,history)=>{client.note97155=note;client.note97155History=structuredClone(history);}});
 vm.runInContext(['current97155SessionContext','noteHistoryEntriesFor','upsertNoteHistoryEntry','draftNoteHistoryMetadata','soapNoteEntryKey','generate97155Note','handleGenerate97155Note'].map(extract).join('\n'),ctx);
 const clinicalBefore=structuredClone(db.sessions);
 await ctx.handleGenerate97155Note();
 assert.equal(client.note97155History.length,1);assert.equal(client.note97155History[0].id,context.sessionId);
 assert.match(client.note97155,/Baseline probe/);assert.match(client.note97155,/Baseline → Treatment/);
 log({type:'target-modified',field:'note',toValue:'Updated protocol'});
 log({type:'target-status-changed',toStatus:'paused'});
 await ctx.handleGenerate97155Note();
 assert.equal(client.note97155History.length,1);assert.equal(client.note97155History[0].status,'draft');
 assert.equal(state.active97155SessionId,context.sessionId);
 assert.match(client.note97155,/Baseline probe/);assert.match(client.note97155,/Baseline → Treatment/);
 assert.match(client.note97155,/Targets introduced/);assert.match(client.note97155,/Targets modified/);
 assert.match(client.note97155,/Targets placed on hold included Program: B/);
 assert.doesNotMatch(client.note97155,/Targets reactivated included[^.]*B/);
 assert.deepEqual(db.sessions,clinicalBefore,'SOAP generation must not create or rewrite clinical observations');
});

test('explicit new workflow actions preserve existing clients, sessions, plans, notes and phase records',()=>{
 const {db,client,act}=fixture();
 const oldClient={id:'old-client',programs:[{id:'historic',objective:'Existing plan',targets:[]}],note97155History:[{id:'closed',status:'finalized',note:'Historical SOAP'}],profile:{graphPhaseLines:{'skill:historic':[{id:'old-phase',date:'2025-01-01',label:'Maintenance'}]}}};
 const oldSession={id:'old-session',clientId:'c',date:'2025-01-01',soapNote:'Existing note',programs:[{programId:'old',targets:[{targetId:'old-target',independence:10}]}],parentGoals:[{goalName:'Historical caregiver goal',fidelity:50}]};
 db.clients.push(oldClient);db.sessions.push(oldSession);
 client.programs.push({id:'old',name:'Historical',objective:'Keep',targets:[{id:'old-target',name:'Keep'}]});
 client.profile.graphPhaseLines['skill:old']=[{id:'old-phase-2',date:'2025-01-01',label:'Maintenance',phaseType:'environmental'}];
 const before=structuredClone({oldClient,oldSession,oldProgram:client.programs[1],oldPhases:client.profile.graphPhaseLines['skill:old']});
 act('save-observation',{targetId:'a',value:0});act('start-treatment',{},'45');
 initializeNewProgramPhases(client,new Set(client.programs.map(p=>p.id)),context);
 buildGraphAnalysis(series(db,client),{phaseMarkers:programPhaseRecords(client,'p')});
 assert.deepEqual({oldClient,oldSession,oldProgram:client.programs[1],oldPhases:client.profile.graphPhaseLines['skill:old']},before);
});

test('finalized/amended noteStatus cannot be bypassed by a conflicting draft status',()=>{
 for(const noteStatus of ['finalized','amended']) {
  const {db,client,act}=fixture();
  client.note97155History.push({id:context.sessionId,date:context.sessionDate,status:'draft',noteStatus});
  const before=structuredClone(db);
  assert.throws(()=>act('save-observation',{targetId:'a',value:0}),/closed/);
  assert.deepEqual(db,before);
 }
});
