import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {planChangesFor97155Session,summarize97155TargetChanges,format97155TargetChangeSummary} from '../public/soap.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf('function generate97155Note(');
const generator=app.slice(start,app.indexOf('\nfunction readBcbaSessionDetails',start));
function event(toStatus,extra={}){return {type:'target-status-changed',clientId:'c1',sessionId:'s1',programId:'p1',programName:'Communication',targetId:'t1',targetName:'Target A',toStatus,timestamp:'2026-11-18T15:00:00Z',...extra};}
function generate(log){
 const h={currentClient:()=>({id:'c1',name:'Synthetic client',planChangeLog:log}),readBcbaSessionDetails:()=>({date:'2026-11-18',rbtPresent:false}),planChangesFor97155Session,summarize97155TargetChanges,format97155TargetChangeSummary,formatDate:v=>v,signatureBlock:()=>''};
 vm.createContext(h);vm.runInContext(generator,h);return h.generate97155Note({clientId:'c1',sessionId:'s1'});
}
for(const [statuses,expected,absent] of [
 [['paused','active','paused'],'Targets placed on hold',['Targets reactivated','Targets mastered']],
 [['active','mastered'],'Targets mastered',['Targets reactivated','Targets placed on hold']],
 [['paused','active'],'Targets reactivated',['Targets placed on hold','Targets mastered']],
 [['mastered','on-hold'],'Targets placed on hold',['Targets mastered','Targets reactivated']],
 [['active','maintenance'],'Targets mastered',['Targets reactivated','Targets placed on hold']]
])test(`generated 97155 Objective uses only final status: ${statuses.join(' → ')}`,()=>{
 const log=statuses.map(status=>event(status));const before=structuredClone(log);
 const note=generate(log);assert.match(note,new RegExp(`O:.*${expected} included Communication: Target A\\.`));
 for(const text of absent)assert.ok(!note.includes(text),text);
 assert.equal(note.split('Communication: Target A').length-1,1);assert.deepEqual(log,before);
});
test('same-session regeneration retains cumulative changes but replaces obsolete status categories',()=>{
 const log=[event('paused'),event('active',{targetId:'t2',targetName:'Target B'})];
 const first=generate(log);assert.match(first,/Targets placed on hold included Communication: Target A/);
 log.push(event('active'),event('paused'));const second=generate(log);
 assert.match(second,/Targets reactivated included Communication: Target B\./);
 assert.match(second,/Targets placed on hold included Communication: Target A\./);
 assert.doesNotMatch(second,/Targets reactivated included [^.]*Target A/);assert.equal(log.length,4);
});
test('stable IDs keep renamed targets together and separate same-named targets in different programs',()=>{
 const log=[event('paused'),event('active',{targetName:'Renamed target'}),event('mastered',{programId:'p2',programName:'Other program'})];
 const text=generate(log);assert.match(text,/Targets reactivated included Communication: Renamed target/);
 assert.match(text,/Targets mastered included Other program: Target A/);assert.doesNotMatch(text,/Targets placed on hold/);
});
test('legacy name grouping remains program-scoped and unrelated sessions do not override final status',()=>{
 const log=[event('paused',{programId:'',targetId:''}),event('active',{programId:'',targetId:''}),event('mastered',{sessionId:'s2'}),event('mastered',{clientId:'c2'})];
 assert.match(generate(log),/Targets reactivated included Communication: Target A/);assert.doesNotMatch(generate(log),/Targets mastered|Targets placed on hold/);
});
test('final removal supersedes earlier statuses, while introduced/modified and protocol work stay cumulative',()=>{
 const log=[event('mastered'),event('',{type:'target-removed'}),event('',{type:'target-added',targetId:'t2',targetName:'New target'}),event('',{type:'target-modified',field:'objective',toValue:'New objective'}),event('',{type:'program-modified',targetId:'',targetName:'',field:'objective',toValue:'Program objective'})];
 const before=JSON.stringify(log);const text=generate(log);
 assert.match(text,/Targets removed included Communication: Target A/);assert.doesNotMatch(text,/Targets mastered/);
 assert.match(text,/Targets introduced/);assert.match(text,/Targets modified/);assert.match(text,/Protocol modifications/);assert.equal(JSON.stringify(log),before);
});
test('a final non-active status never leaves an obsolete mastered/reactivated/hold label',()=>{
 const text=generate([event('active'),event('inactive')]);assert.doesNotMatch(text,/Targets reactivated|Targets mastered|Targets placed on hold/);
});
