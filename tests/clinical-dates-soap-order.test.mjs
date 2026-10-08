import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
process.env.TZ='America/New_York';
function clockContext(instant) {
  const RealDate=Date;
  const Clock=class extends RealDate {
    constructor(...args) { super(...(args.length?args:[instant])); }
  };
  const ctx=vm.createContext({Date:Clock});
  vm.runInContext(extract('dateInputValue'),ctx);
  return ctx;
}

test('local clinical date stays October 8 until Miami midnight and rolls at midnight',()=>{
  for(const [instant,expected] of [
    ['2026-10-09T01:30:00.000Z','2026-10-08'],
    ['2026-10-09T03:59:59.999Z','2026-10-08'],
    ['2026-10-09T04:00:00.000Z','2026-10-09'],
    ['2026-01-09T04:59:59.999Z','2026-01-08'],
    ['2026-01-09T05:00:00.000Z','2026-01-09']
  ]) {
    const ctx=clockContext(instant);
    assert.equal(ctx.dateInputValue(),expected);
    assert.equal(vm.runInContext('new Date().toISOString()',ctx),instant);
  }
});

test('97153, 97155, 97156 and report defaults all use local calendar dates',()=>{
  for(const [instant,expected] of [['2026-10-09T03:59:59.999Z','2026-10-08'],['2026-10-09T04:00:00.000Z','2026-10-09']]) {
    const ctx=clockContext(instant);
    for(const name of ['form','bcbaSessionForm','parentTrainingForm']) ctx[name]={elements:{date:{value:''}}};
    ctx.reportForm={elements:{startDate:{},endDate:{}}};ctx.toggleRbtFeedbackSection=()=>{};
    vm.runInContext(['defaultReportDateRange','setDefaultDate','currentPlanChangeDate','signatureBlock'].map(extract).join('\n'),ctx);
    ctx.setDefaultDate();
    for(const name of ['form','bcbaSessionForm','parentTrainingForm']) assert.equal(ctx[name].elements.date.value,expected);
    assert.equal(ctx.reportForm.elements.endDate.value,expected);
    assert.equal(ctx.reportForm.elements.startDate.value,expected.replace('-10-','-04-'));
    ctx.bcbaSessionForm.elements.date.value='';assert.equal(ctx.currentPlanChangeDate(),expected);
    ctx.formatDate=String;assert.match(ctx.signatureBlock('Provider','BCBA',''),new RegExp(expected));
    ctx.bcbaSessionForm.elements.date.value='2025-02-03';assert.equal(ctx.currentPlanChangeDate(),'2025-02-03');
  }
});

test('SOAP record default service date is local while created/updated/save timestamps remain UTC',()=>{
  const instant='2026-10-09T01:30:00.000Z';const ctx=clockContext(instant);
  ctx.cryptoId=()=> 'new-note';ctx.state={currentUser:{id:'provider'}};
  vm.runInContext(extract('noteHistoryRecordFromPayload'),ctx);
  const record=ctx.noteHistoryRecordFromPayload({type:'97155'},{soapNote:'unchanged text'},'draft');
  assert.equal(record.date,'2026-10-08');
  for(const field of ['createdAt','updatedAt','lastSavedAt']) assert.equal(record[field],instant);
  const historical=ctx.noteHistoryRecordFromPayload({type:'97155',record:{date:'2025-06-01',createdAt:'2025-06-01T16:00:00.000Z'}},{soapNote:'unchanged text'},'draft');
  assert.equal(historical.date,'2025-06-01');assert.equal(historical.createdAt,'2025-06-01T16:00:00.000Z');
  for(const name of ['handleFinalize','handleAmendment']) {
    // Both SOAP signature fallback paths use the shared calendar helper.
    if(app.includes(`function ${name}(`)) assert.doesNotMatch(extract(name),/toISOString\(\)\.slice/);
  }
  assert.equal((app.match(/if \(!payload.signatureDate\) payload.signatureDate = dateInputValue\(\);/g)||[]).length,2);
  assert.match(extract('captureReportClinicalSnapshot'),/preparationDate: dateInputValue\(\)/);
  assert.match(extract('captureReportClinicalSnapshot'),/capturedAt: new Date\(\).toISOString\(\)/);
});

function historyFixture() {
  const records=[
    {id:'old',date:'2026-09-01',updatedAt:'2026-12-01T12:00:00Z',note:'Old service, recently edited'},
    {id:'same-old',date:'2026-10-08',createdAt:'2026-10-08T11:00:00Z'},
    {id:'latest',date:'2026-10-09',createdAt:'2026-10-09T08:00:00Z'},
    {id:'same-new',date:'2026-10-08',updatedAt:'2026-10-08T15:00:00Z'},
    {id:'missing-old',createdAt:'2026-01-01T00:00:00Z'},
    {id:'missing-new',updatedAt:'2026-11-01T00:00:00Z'},
    {id:'tied-first',date:'2026-10-07',createdAt:'2026-10-07T08:00:00Z'},
    {id:'tied-second',date:'2026-10-07',createdAt:'2026-10-07T08:00:00Z'}
  ];
  const assessment=[{id:'a-new',date:'2026-10-08',createdAt:'2026-10-08'},{id:'a-old',date:'2026-10-01',createdAt:'2026-10-01'}];
  const sessions=[{id:'s-new',serviceType:'97153'},{id:'parent-new',serviceType:'parent-training'},{id:'s-old',serviceType:'97153'},{id:'parent-old',serviceType:'parent-training'}];
  const container={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
  const ctx=vm.createContext({currentSessions:()=>sessions,currentClient:()=>({}),noteHistoryEntriesFor:code=>code==='97155'?records:assessment,
    soapNoteEntryKey:(code,id)=>`${code}:${id}`,document:{querySelector:()=>container},
    state:{activeSoapHistoryTab:'97155',selectedSoapEntryKey:'97155:latest',soapHistoryVisibleLimit:40},SOAP_SESSION_PAGE_SIZE:40,
    renderSoapHistoryTabs:()=>{},escapeHtml:String,formatDate:String,soapEntryStatus:()=> 'draft',soapStatusClass:()=>'',soapStatusLabelText:()=> 'Draft'});
  vm.runInContext(['soapHistoryEntries','selectedSoapEntry','sessionCodeLabel','soapEntryGroup','soapEntryActivityLabel','renderHistory'].map(extract).join('\n'),ctx);
  return {ctx,records,container};
}
test('97155 entries and rendered history use descending service date with timestamp ties, without mutation',()=>{
  const {ctx,records,container}=historyFixture();const original=JSON.stringify(records);
  const expected=['latest','same-new','same-old','tied-first','tied-second','old','missing-new','missing-old'];
  assert.deepEqual(Array.from(ctx.soapHistoryEntries().filter(e=>e.type==='97155'),e=>e.record.id),expected);
  ctx.renderHistory();
  assert.deepEqual([...container.innerHTML.matchAll(/data-soap-entry="97155:([^"]+)"/g)].map(m=>m[1]),expected);
  assert.equal(JSON.stringify(records),original);
  ctx.renderHistory();assert.equal(JSON.stringify(records),original);
});
test('97151, 97153 and 97156 retain their existing order',()=>{
  const {ctx}=historyFixture();const entries=ctx.soapHistoryEntries();
  assert.deepEqual(Array.from(entries.filter(e=>e.type==='97151'),e=>e.record.id),['a-old','a-new']);
  assert.deepEqual(Array.from(entries.filter(e=>e.type==='session'&&e.session.serviceType==='97153'),e=>e.key),['s-new','s-old']);
  assert.deepEqual(Array.from(entries.filter(e=>e.type==='session'&&e.session.serviceType==='parent-training'),e=>e.key),['parent-new','parent-old']);
});
