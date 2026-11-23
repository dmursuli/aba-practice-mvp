import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {authorizationUtilization,sessionDurationMinutes,billingUnits} from '../public/authorization-utilization.js';
const client=()=>({id:'c',profile:{authorization:{startDate:'2026-01-01',endDate:'2026-06-30',services:Object.fromEntries(['97151','97153','97155','97156'].map(code=>[code,{hours:'10',units:'40'}]))}},note97151History:[],note97155History:[]});
const encounter=(code,extra={})=>({id:'s',clientId:'c',serviceCode:code,date:'2026-02-01',startTime:'09:00',endTime:'10:00',finalized:true,noteStatus:'finalized',soapNote:'Synthetic SOAP',note:'Synthetic SOAP',...extra});
const row=(c,s,code='97153',period)=>authorizationUtilization(c,s,period).find(r=>r.code===code);
for(const code of ['97151','97153','97155','97156']) test(`${code} finalized clinical documentation contributes hours, minutes, units and remaining approval`,()=>{
 const c=client(),record=encounter(code);const sessions=[];
 if(['97151','97155'].includes(code))c[`note${code}History`].push(record);else sessions.push(record);
 const before=structuredClone({c,sessions});const usage=row(c,sessions,code);
 assert.deepEqual([usage.usedMinutes,usage.usedHours,usage.usedUnits,usage.remainingHours,usage.remainingUnits],[60,1,4,9,36]);
 assert.deepEqual([usage.approvedHours,usage.approvedUnits],[10,40]);assert.deepEqual({c,sessions},before);
});
test('distinct same-code same-day encounters sum; different codes sharing an ID stay separate',()=>{
 const c=client(),sessions=[encounter('97153'),encounter('97153',{id:'s2'}),encounter('97156')];
 assert.equal(row(c,sessions).usedUnits,8);assert.equal(row(c,sessions,'97156').usedUnits,4);
});
for(const [date,units] of [['2025-12-31',0],['2026-01-01',4],['2026-06-30',4],['2026-07-01',0]]) test(`authorization period inclusive filter: ${date}`,()=>{
 assert.equal(row(client(),[encounter('97153',{date})]).usedUnits,units);
});
for(const status of ['draft','discarded','deleted','abandoned','invalid']) test(`${status} documentation is excluded`,()=>{
 const c=client();c.note97155History=[encounter('97155',{status,noteStatus:status,finalized:false})];
 assert.equal(row(c,[], '97155').usedUnits,0);
 assert.equal(row(c,[encounter('97153',{noteStatus:status,finalized:false})]).usedUnits,0);
});
test('deleted/discarded flags override finalized state; clinical-only probes never count',()=>{
 const c=client();
 for(const flags of [{deleted:true},{discardedAt:'2026-02-02'},{clinicalDataOnly:true}]) assert.equal(row(c,[encounter('97153',flags)]).usedUnits,0);
});
test('SOAP linked to session and repeated stable IDs count once, with latest authoritative revision',()=>{
 const c=client();c.note97155History=[encounter('97155',{id:'note',sessionId:'s',updatedAt:'2026-02-03',endTime:'10:30'})];
 const sessions=[encounter('97155',{updatedAt:'2026-02-01'}),encounter('97155',{updatedAt:'2026-02-02'})];
 assert.equal(row(c,sessions,'97155').usedUnits,6);
 c.note97155History[0].date='2026-07-01';assert.equal(row(c,sessions,'97155').usedUnits,0,'do not revive older in-period representation');
});
test('newest discarded representation cannot revive an older finalized service',()=>{
 const c=client();c.note97155History=[encounter('97155',{id:'note',sessionId:'s',updatedAt:'2026-02-03',discarded:true})];
 assert.equal(row(c,[encounter('97155',{updatedAt:'2026-02-01'})],'97155').usedUnits,0);
});
test('legacy 97153 serviceType and parent-training mapping preserve existing code conventions',()=>{
 assert.equal(row(client(),[encounter(undefined,{serviceType:'97153'})]).usedUnits,4);
 assert.equal(row(client(),[encounter(undefined,{serviceType:'parent-training'})],'97156').usedUnits,4);
 assert.equal(row(client(),[encounter(undefined)]).usedUnits,4);
});
test('unit rounding reuses existing per-encounter convention including partial hours',()=>{
 assert.equal(sessionDurationMinutes('09:00','09:22'),22);assert.equal(billingUnits(22),1);assert.equal(billingUnits(23),2);
 const usage=row(client(),[encounter('97153',{endTime:'09:22'}),encounter('97153',{id:'other',endTime:'09:22'})]);
 assert.equal(usage.usedMinutes,44);assert.equal(usage.usedUnits,2);assert.equal(usage.usedHours,0.73);assert.equal(usage.remainingHours,9.27);
});
test('missing, malformed, reversed and zero timing cannot fabricate utilization',()=>{
 for(const times of [{startTime:''},{endTime:''},{startTime:'25:00'},{startTime:'9:x'},{endTime:'08:00'},{endTime:'09:00'}]) assert.equal(row(client(),[encounter('97153',times)]).usedUnits,0);
});
test('historical periods remain isolated, client ownership enforced, no note-text CPT inference',()=>{
 const c=client(),sessions=[encounter('97153'),encounter('97153',{id:'old',date:'2025-02-01'}),encounter('97153',{clientId:'other'}),encounter('unknown',{soapNote:'97153 service'})];
 assert.equal(row(c,sessions).usedUnits,4);
 assert.equal(row(c,sessions,'97153',{startDate:'2025-01-01',endDate:'2025-06-30'}).usedUnits,4);
});
test('absent note and invalid dates/authorization exclude without default service time',()=>{
 assert.equal(row(client(),[encounter('97153',{soapNote:''})]).usedUnits,0);
 assert.equal(row(client(),[encounter('97153',{date:'2026-02-31'})]).usedUnits,0);
 assert.equal(row(client(),[encounter('97153')],'97153',{startDate:'',endDate:''}).usedUnits,0);
});
test('legacy history without timing remains excluded; amended encounter uses current saved timing',()=>{
 const c=client();c.note97151History=[encounter('97151',{id:'legacy-97151',startTime:'',endTime:''})];assert.equal(row(c,[],'97151').usedUnits,0);
 c.note97151History=[encounter('97151',{noteStatus:'amended',endTime:'11:00',finalized:false})];assert.equal(row(c,[],'97151').usedUnits,8);
});
test('fallback deduplication only applies when no stable ID exists',()=>{
 const c=client(),a=encounter('97153',{id:undefined});assert.equal(row(c,[a,{...a}]).usedUnits,4);
 assert.equal(row(c,[{...a,id:'a'},{...a,id:'b'}]).usedUnits,8);
});
test('actual authorization wrapper uses the selected period and full client sessions; existing cards remain',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const extract=name=>app.match(new RegExp(`^function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
 const sandbox={authorizationUtilization,loadedSessions:()=>[encounter('97153')]};
 vm.createContext(sandbox);vm.runInContext(extract('authorizationUsageByCode'),sandbox);
 assert.equal(sandbox.authorizationUsageByCode(client()).find(r=>r.code==='97153').usedUnits,4);
 const missingPeriod=client();missingPeriod.profile.authorization.startDate='';
 assert.equal(sandbox.authorizationUsageByCode(missingPeriod).find(r=>r.code==='97153').usedUnits,0);
 assert.match(extract('viewNeedsClientSessions'),/"clients"/);assert.match(extract('rerenderSessionBackedView'),/view === "clients".*renderAuthorizationUsage/);
 assert.doesNotMatch(extract('renderAuthorizationUsage'),/timed billing entries/);
 assert.match(extract('renderAuthorizationUsage'),/Utilization updates automatically from saved clinical services/);
});

test('selected historical authorization uses its own approvals without changing either period',()=>{
 const c=client(),period={startDate:'2025-01-01',endDate:'2025-06-30',services:{'97153':{hours:'20',units:'80'}}};
 const sessions=[encounter('97153'),encounter('97153',{id:'old',date:'2025-02-01'})];
 const before=structuredClone({c,period,sessions});
 const usage=row(c,sessions,'97153',period);
 assert.deepEqual([usage.usedMinutes,usage.approvedHours,usage.approvedUnits,usage.remainingHours,usage.remainingUnits],[60,20,80,19,76]);
 assert.deepEqual({c,period,sessions},before);
});
test('clinical data linked to a completed encounter is not additional service time',()=>{
 const c=client(),session=encounter('97153');
 assert.equal(row(c,[session,{...session,id:'probe',sessionId:'s',clinicalDataOnly:true}]).usedUnits,4);
});
