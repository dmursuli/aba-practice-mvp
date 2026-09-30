import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
function fixture(target={},log=[]) {
  let programs=[{id:'p',name:'Program',status:'active',targets:[{id:'t',name:'Target',status:'active',...target}]}];
  const saved=[];
  const context=vm.createContext({structuredClone,Date,
    normalizeMasteryDate:v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)?v.slice(0,10):'',
    currentClient:()=>({planChangeLog:log}), clientPrograms:()=>programs,
    currentSessions:()=>{throw Error('Treatment Plan must not infer dates from loaded sessions');},
    currentPlanDraft:()=>({programs:structuredClone(programs),behaviors:[]}),
    bcbaSessionForm:{elements:{date:{value:'2026-09-18'}}},
    trackPlanSave:p=>p,savePlan:async(p,b,change)=>{programs=structuredClone(p);saved.push({programs,change});},
    formMessage:{textContent:''},renderPlanReview:()=>{}
  });
  vm.runInContext(['normalizePlanStatus','explicitPlanMasteryDate','firstPlanMasteryChangeDate','resolvePlanTargetMasteryDate','resolvePlanProgramMasteryDate','currentPlanChangeDate','handlePlanStatusChange'].map(extract).join('\n'),context);
  const change=(value,wholeProgram=false)=>context.handlePlanStatusChange({target:{closest:selector=>{
    if(wholeProgram&&selector==='[data-plan-program-status]')return {value,dataset:{planProgramStatus:'p'}};
    if(!wholeProgram&&selector==='[data-plan-program][data-plan-target]')return {value,dataset:{planProgram:'p',planTarget:'t'}};
    return null;
  }}});
  return {context,change,saved,programs:()=>programs};
}

test('explicit dates and target-specific decision logs remain authoritative without session inference',()=>{
  const f=fixture({},[{type:'target-status-changed',programId:'p',targetId:'t',toStatus:'mastered',date:'2026-01-10'}]);
  for(const field of ['maintenanceDate','masteredDate','masteryDate']) {
    assert.equal(f.context.resolvePlanTargetMasteryDate({id:'p'},{id:'t',[field]:'2025-12-15'}),'2025-12-15');
  }
  assert.equal(f.context.resolvePlanTargetMasteryDate({id:'p'},{id:'t'}),'2026-01-10');
  const unrecorded=fixture({},[{type:'program-status-changed',programId:'p',toStatus:'mastered',date:'2026-01-01'}]);
  assert.equal(unrecorded.context.resolvePlanTargetMasteryDate({id:'p'},{id:'t',status:'mastered'}),'');
  assert.doesNotMatch(app,/inferredPlanTargetMasteryDate/);
  assert.doesNotMatch(extract('resolvePlanTargetMasteryDate'),/currentSessions|independence|frequency/);
});

test('manual active/on-hold mastery uses clinical change date, preserves IDs and logs transition',async()=>{
  for(const status of ['active','paused']) {
    const f=fixture({status});await f.change('mastered');
    assert.equal(f.programs()[0].targets[0].maintenanceDate,'2026-09-18');
    assert.equal(f.programs()[0].targets[0].id,'t');
    assert.equal(f.saved[0].change.type,'target-status-changed');
    assert.equal(f.saved[0].change.fromStatus,status);assert.equal(f.saved[0].change.toStatus,'mastered');
  }
  const f=fixture();f.context.bcbaSessionForm.elements.date.value='';
  await f.change('mastered');
  assert.equal(f.programs()[0].targets[0].maintenanceDate,new Date().toISOString().slice(0,10));
});

test('reversals preserve documented dates and do not silently backfill legacy mastered records',async()=>{
  const f=fixture({status:'mastered',maintenanceDate:'2025-02-03'});
  for(const status of ['active','paused','mastered']) {
    await f.change(status);assert.equal(f.programs()[0].targets[0].maintenanceDate,'2025-02-03');
  }
  for(const status of ['mastered','maintenance']) {
    const legacy=fixture({status});await legacy.change('mastered');
    assert.equal(legacy.programs()[0].targets[0].maintenanceDate,undefined);
    assert.equal(legacy.context.normalizePlanStatus(status),'mastered');
  }
});

test('program mastery dates only newly mastered targets; paused and historical mastered targets are preserved',async()=>{
  const f=fixture();
  f.programs()[0].targets.push({id:'paused',status:'paused'},{id:'legacy',status:'maintenance'},
    {id:'explicit',status:'active',maintenanceDate:'2025-04-01'});
  await f.change('mastered',true);
  const program=f.programs()[0];
  assert.equal(program.masteredDate,'2026-09-18');
  assert.equal(program.targets[0].maintenanceDate,'2026-09-18');
  assert.equal(program.targets[1].status,'paused');assert.equal(program.targets[1].maintenanceDate,undefined);
  assert.equal(program.targets[2].maintenanceDate,undefined);
  assert.equal(program.targets[3].maintenanceDate,'2025-04-01');
  assert.equal(f.saved[0].change.type,'program-status-changed');
});
