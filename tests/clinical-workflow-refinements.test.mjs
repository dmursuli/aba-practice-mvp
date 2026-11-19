import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parentTrainingCollectionMetrics,adjustParentTrainingResponse} from '../public/parent-training-report.js';
import {planChangesFor97155Session} from '../public/soap.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
function source(name){const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0,name);const end=[app.indexOf('\nfunction ',start+1),app.indexOf('\nasync function ',start+1)].filter(n=>n>=0);return app.slice(start,Math.min(...end));}
function load(h,names){vm.createContext(h);for(const name of names)vm.runInContext(source(name),h);return h;}
const template=id=>html.slice(html.indexOf(`<template id="${id}"`),html.indexOf('</template>',html.indexOf(`<template id="${id}"`)));
test('Session sorts displayed program rows stably, retaining target and stored program order',()=>{
 const programs=[{id:'t',name:'Tacting'},{id:'m',name:'Manding'},{id:'w',name:'will engage'},{id:'n',name:'12-e Tacts'},{id:'m2',name:'manding'}];
 const rows=['t','m','m','w','n','m2'].map((id,index)=>({index,querySelector:()=>({value:id})}));const original=JSON.stringify(programs);let displayed=[];
 const h=load({clientPrograms:()=>programs,programList:{querySelectorAll:()=>rows,append:row=>displayed.push(row.index)}},['sortSessionProgramRows']);
 h.sortSessionProgramRows();assert.deepEqual(displayed,[4,1,2,5,0,3]);assert.equal(JSON.stringify(programs),original);
 assert.match(source('applySessionTargetFilter'),/rowMode !== state.activeSessionTargetTab \|\| !domainMatches/);
});
test('counter DOM order is Incorrect/Correct and Prompted/Independent without changing hooks',()=>{
 const skill=template('program-template'),parent=template('parent-goal-template');
 assert.ok(skill.indexOf('data-record-response="incorrect"')<skill.indexOf('data-record-response="correct"'));
 assert.ok(skill.indexOf('data-field="incorrect"')<skill.indexOf('data-field="correct"'));
 assert.ok(parent.indexOf('data-parent-goal-response="prompted"')<parent.indexOf('data-parent-goal-response="independent"'));
 for(const field of ['independent','prompted','opportunities','promptLevel'])assert.match(parent,new RegExp(`data-field="${field}"`));
});
test('correct/incorrect clicks, undo, percentage, and manual totals preserve semantics',()=>{
 const nodes=new Map();const row={responseHistory:[],querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'0',textContent:'',disabled:false});return nodes.get(selector);},querySelectorAll:()=>[]};
 row.querySelector('[data-field="dataCollectionType"]').value='percent_correct';
 const h=load({saveSessionDraft(){},normalizeSkillDataCollectionType:v=>v},['recordSkillResponse','undoSkillResponse','updateProgramIndependence','syncTrialBalance']);
 h.recordSkillResponse(row,'incorrect');h.recordSkillResponse(row,'correct');h.recordSkillResponse(row,'correct');
 assert.equal(row.querySelector('[data-field="correct"]').value,'2');assert.equal(row.querySelector('[data-field="incorrect"]').value,'1');assert.equal(row.querySelector('[data-independence]').textContent,'67%');
 h.undoSkillResponse(row);assert.equal(row.querySelector('[data-field="correct"]').value,'1');assert.equal(row.querySelector('[data-field="incorrect"]').value,'1');
 row.querySelector('[data-field="trials"]').value='4';row.querySelector('[data-field="correct"]').value='3';h.syncTrialBalance(row,'correct');h.updateProgramIndependence(row);
 assert.equal(row.querySelector('[data-field="trials"]').value,'4');assert.equal(row.querySelector('[data-independence]').textContent,'75%');
});
test('only active stagnant targets qualify and badge counts use the same eligible set without mutating review history',()=>{
 const targets=['active','paused','on-hold','mastered','retired','inactive','unknown'].map((status,i)=>({id:String(i),status}));
 const program={id:'p',targets};const snapshot={counts:{stagnant:7,ready:2}};
 const h=load({state:{activePlanReviewFilter:'stagnant'},clientPrograms:()=>[program],targetReviewCacheEntry:()=>({snapshot}),masteryReviewForTarget:()=>({state:'stagnant'})},['activeStagnantTarget','masteryReviewCounts','targetMatchesPlanReviewFilter']);
 assert.deepEqual(targets.filter(t=>h.targetMatchesPlanReviewFilter(program,t)).map(t=>t.id),['0']);assert.equal(h.masteryReviewCounts().stagnant,1);assert.equal(h.masteryReviewCounts().ready,2);assert.equal(snapshot.counts.stagnant,7);
 assert.match(source('jumpToReviewState'),/activeStagnantTarget\(program, target\)/);
});
function contextHarness(){
 let id=0;const client={id:'c',planChangeLog:[],note97155History:[],note97151History:[]};
 const h={state:{active97155SessionId:'',currentUser:{id:'u'}},cryptoId:()=>`s${++id}`,currentClient:()=>client,currentPlanChangeDate:()=>h.bcbaSessionForm.elements.date.value,
 bcbaSessionForm:{elements:{date:{value:'2026-11-18'},startTime:{value:'09:00'}}},structuredClone,
 soapEntryStatus:({record})=>record?.noteStatus || record?.status || 'finalized',
 persistCurrentPlanDraftBefore97155Generation:async()=>{},refreshCurrentClientPlanBefore97155Generation:async()=>{},
 readBcbaSessionDetails:()=>({date:h.currentPlanChangeDate(),startTime:h.bcbaSessionForm.elements.startTime.value,endTime:'10:00',setting:'home',providerSignature:'Provider',providerCredential:'BCBA',rbtPresent:false}),
 confirmRegenerateNote:()=>true,clientPrograms:()=>[],clientBehaviors:()=>[],clientDomains:()=>[],clientRbtPerformanceAreas:()=>[],
 savePlan:async(a,b,c,note,d,e,f,history)=>{client.note97155=note;client.note97155History=history;},
 note97155Status:{},note97155Editor:{},planMessage:{},noteStatus:{},renderHistory(){},renderNote(){},renderSoapSummary(){}};
 h.generate97155Note=context=>planChangesFor97155Session(client.planChangeLog,context).map(change=>change.detail).join(' + ');
 load(h,['current97155SessionContext','noteHistoryEntriesFor','upsertNoteHistoryEntry','draftNoteHistoryMetadata','soapNoteEntryKey','handleGenerate97155Note','saveNoteHistoryRecord']);
 h.change=detail=>client.planChangeLog.push({...h.current97155SessionContext(),detail});return {h,client};
}
test('97155 A → generate → B → regenerate retains full cumulative changes and one logical draft',async()=>{
 const {h,client}=contextHarness();h.change('A');await h.handleGenerate97155Note();const id=client.note97155History[0].id,created=client.note97155History[0].createdAt;
 h.change('B');await h.handleGenerate97155Note();await h.handleGenerate97155Note();
 assert.equal(client.note97155History.length,1);assert.equal(client.note97155History[0].id,id);assert.equal(client.note97155History[0].createdAt,created);assert.equal(client.note97155History[0].note,'A + B');
});
test('97155 finalization closes context; later work leaves finalized and historical notes untouched',async()=>{
 const {h,client}=contextHarness();client.note97155History.push({id:'history',sessionId:'history',date:'2025-01-01',status:'finalized',note:'historical'});
 h.change('A');await h.handleGenerate97155Note();const record={...client.note97155History[0],status:'finalized',noteStatus:'finalized',finalized:true};
 await h.saveNoteHistoryRecord({type:'97155'},record,'Finalized');assert.equal(h.state.active97155SessionId,'');const before=JSON.stringify(client.note97155History);
 h.change('B');assert.notEqual(h.state.active97155SessionId,record.sessionId);assert.equal(JSON.stringify(client.note97155History),before);
 await h.handleGenerate97155Note();assert.equal(client.note97155History.find(e=>e.id===record.id).note,'A');assert.equal(client.note97155History.find(e=>e.id==='history').note,'historical');assert.equal(client.note97155History.filter(e=>e.status==='draft')[0].note,'B');
});
test('97155 returning to a saved draft reuses its existing record ID; different service time starts another context',async()=>{
 const {h,client}=contextHarness();h.change('A');await h.handleGenerate97155Note();client.note97155History[0].id='legacy-draft-id';h.state.active97155SessionId='';
 h.change('B');await h.handleGenerate97155Note();assert.equal(client.note97155History.length,1);assert.equal(client.note97155History[0].id,'legacy-draft-id');assert.equal(client.note97155History[0].note,'A + B');
 h.bcbaSessionForm.elements.startTime.value='13:00';h.change('C');await h.handleGenerate97155Note();assert.equal(client.note97155History.length,2);
});
test('Parent Training uses compact shared counters, neutral stagnant cards and responsive layout',()=>{
 assert.match(css,/\.parent-goal-row.stagnant-target \{ background: #fff;/);
 assert.match(css,/\.parent-goal-review:empty \{ display: none;/);
 assert.match(css,/@media \(max-width: 1100px\)[\s\S]*\.parent-goal-controls \{ grid-template-columns: minmax\(0, 1fr\)/);
 const parent=template('parent-goal-template');for(const hook of ['data-undo-parent-goal-response','data-mark-parent-goal-mastered','data-parent-goal-review','data-remove'])assert.ok(parent.includes(hook));
});

test('Parent Training responses and undo retain independent/prompted semantics and prompt level',()=>{
 const nodes=new Map();const row={dataset:{parentGoalEditable:'true'},responseHistory:[],classList:{add(){},remove(){}},querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'0',textContent:'',disabled:false});return nodes.get(selector);},querySelectorAll:()=>[]};
 row.querySelector('[data-field="promptLevel"]').value='verbal';
 const readDataRow=row=>Object.fromEntries(['independent','prompted','opportunities','promptLevel'].map(field=>[field,row.querySelector(`[data-field="${field}"]`).value]));
 const h=load({readDataRow,parentTrainingCollectionMetrics,adjustParentTrainingResponse,normalizeParentGoal:v=>v,parentGoalReview:()=>({message:'Stagnant warning'}),applyParentGoalFilter(){}},['recordParentGoalResponse','undoParentGoalResponse','updateParentGoalScore']);
 h.recordParentGoalResponse(row,'prompted');h.recordParentGoalResponse(row,'independent');h.recordParentGoalResponse(row,'independent');
 assert.equal(readDataRow(row).independent,'2');assert.equal(readDataRow(row).prompted,'1');assert.equal(readDataRow(row).opportunities,'3');assert.equal(readDataRow(row).promptLevel,'verbal');
 h.undoParentGoalResponse(row);assert.equal(readDataRow(row).independent,'1');assert.equal(readDataRow(row).prompted,'1');assert.equal(row.querySelector('[data-parent-goal-score]').textContent,'50%');
});
test('durable 97153 restoration keeps distinct correct/incorrect values and undo history',()=>{
 let restored;const h=load({state:{},form:{elements:{}},programList:{},behaviorList:{},addProgramRow:(programId,targetId,values)=>{restored={values,querySelector:()=>({})};return restored;},addBehaviorRow(){},renderDomainTabs(){},refreshTargetAvailability(){},refreshBehaviorAvailability(){}},['applyDurableSessionDraftPayload']);
 h.applyDurableSessionDraftPayload({payload:{programs:[{programId:'p',targetId:'t',trials:4,correct:3,incorrect:1,responseHistory:['correct','incorrect','correct','correct']}],behaviors:[]}});
 assert.equal(restored.values.correct,3);assert.equal(restored.values.incorrect,1);assert.equal(restored.responseHistory.join(','),'correct,incorrect,correct,correct');assert.equal(h.state.sessionDraftRestoring,false);
});
