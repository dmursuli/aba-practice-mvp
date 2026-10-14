import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'aba-session-drafts-'));
process.env.DB_PATH=join(dir,'db.json');
process.env.SESSION_DRAFT_DB_PATH=join(dir,'session-drafts.json');
process.env.MFA_ENABLED='false';
process.env.ABA_DISABLE_AUTOSTART='1';
const baseDb={clients:[{id:'c1',name:'Client',agency:'Triumph ABA',status:'active',programs:[{id:'p1',name:'Program',dataCollectionType:'percent_correct',targets:[{id:'t1',name:'Target'}]}],behaviors:[{id:'b1',name:'Behavior',status:'active'}],profile:{}}],sessions:[],auditLog:[],users:[]};
const {createAppServer,resetRuntimeState}=await import('../server.js');
let server,baseUrl;
before(async()=>{server=createAppServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{resetRuntimeState();await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{resetRuntimeState();await writeFile(process.env.DB_PATH,JSON.stringify(baseDb));await writeFile(process.env.SESSION_DRAFT_DB_PATH,JSON.stringify({drafts:[]}));});
async function request(path,{method='GET',body,cookie}={}) {const response=await fetch(baseUrl+path,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();return {response,json:text?JSON.parse(text):{},cookie:response.headers.get('set-cookie')?.split(';')[0]||cookie};}
async function login(name='admin',password='admin123'){const result=await request('/api/auth/login',{method:'POST',body:{username:name,password}});assert.equal(result.response.status,200);return result.cookie;}
const payload=()=>({fields:{date:'2026-10-06',therapist:'RBT',setting:'home',startTime:'09:00',endTime:'',notes:'',providerSignature:'',providerCredential:''},programs:[{programId:'p1',targetId:'t1',dataCollectionType:'percent_correct',trials:'0',correct:'0',incorrect:'0',promptLevel:'verbal',phase:'intervention',responseHistory:['correct','incorrect']}],behaviors:[{behaviorId:'b1',frequency:0,duration:'',intensity:'',phase:'intervention'}]});
const completePayload=()=>({clientId:'c1',date:'2026-10-06',therapist:'RBT',setting:'home',startTime:'09:00',endTime:'11:00',caregiverPresent:false,caregiverTraining:false,affect:'engaged',transitions:'typical',barriers:'none',barrierText:'',notes:'done',providerSignature:'RBT',providerCredential:'RBT',programs:[{programId:'p1',targets:[{targetId:'t1',dataCollectionType:'percent_correct',trials:2,correct:1,incorrect:1,promptLevel:'verbal',phase:'intervention'}]}],behaviors:[{behaviorId:'b1',frequency:0,duration:'',intensity:'',phase:'intervention'}],soapNote:'SOAP'});

test('create/update/reload preserves incomplete fields, genuine zeros, observations, prompt and undo state',async()=>{
  const cookie=await login();let result=await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',serviceType:'97153',payload:payload()}});
  assert.equal(result.response.status,201);const draft=result.json;
  assert.equal(draft.payload.fields.endTime,'');assert.equal(draft.payload.behaviors[0].frequency,0);assert.equal(draft.payload.programs[0].promptLevel,'verbal');assert.deepEqual(draft.payload.programs[0].responseHistory,['correct','incorrect']);
  const changed=payload();changed.fields.notes='debounced narrative';changed.programs[0].correct='1';changed.programs[0].responseHistory=['correct'];changed.behaviors=[];
  result=await request(`/api/session-drafts/${draft.id}`,{method:'PUT',cookie,body:{expectedRevision:draft.revision,payload:changed}});
  assert.equal(result.response.status,200);assert.equal(result.json.revision,2);assert.equal(result.json.payload.fields.notes,'debounced narrative');assert.deepEqual(result.json.payload.behaviors,[]);
  resetRuntimeState();const reauthenticated=await login();
  result=await request(`/api/session-drafts?clientId=c1`,{cookie:reauthenticated});assert.equal(result.json.drafts.length,1);assert.equal(result.json.drafts[0].payload.programs[0].correct,'1');
  const again=await request(`/api/session-drafts/${draft.id}`,{cookie:reauthenticated});assert.equal(again.json.payload.fields.notes,'debounced narrative');
});

test('authorization and optimistic concurrency reject foreign and stale writes without overwrite',async()=>{
  const admin=await login();const created=(await request('/api/session-drafts',{method:'POST',cookie:admin,body:{clientId:'c1',payload:payload()}})).json;
  const bcba=await login('bcba','bcba123');assert.equal((await request(`/api/session-drafts/${created.id}`,{cookie:bcba})).response.status,403);
  const first=payload();first.fields.notes='newer';const updated=await request(`/api/session-drafts/${created.id}`,{method:'PUT',cookie:admin,body:{expectedRevision:1,payload:first}});assert.equal(updated.response.status,200);
  const stale=payload();stale.fields.notes='stale';const conflict=await request(`/api/session-drafts/${created.id}`,{method:'PUT',cookie:admin,body:{expectedRevision:1,payload:stale}});assert.equal(conflict.response.status,409);assert.equal(conflict.json.code,'DRAFT_CONFLICT');
  assert.equal((await request(`/api/session-drafts/${created.id}`,{cookie:admin})).json.payload.fields.notes,'newer');
});

test('completion validates, creates one ordinary session, is idempotent and removes resumable draft',async()=>{
  const cookie=await login();const draft=(await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}})).json;
  const invalid=await request(`/api/session-drafts/${draft.id}/complete`,{method:'POST',cookie,body:{expectedRevision:1,session:{}}});assert.equal(invalid.response.status,400);
  let result=await request(`/api/session-drafts/${draft.id}/complete`,{method:'POST',cookie,body:{expectedRevision:1,session:completePayload()}});assert.equal(result.response.status,201);const sessionId=result.json.session.id;assert.equal(result.json.session.sourceDraftId,draft.id);assert.equal(result.json.session.behaviors[0].frequency,0);assert.equal(result.json.session.noteStatus,'draft');
  result=await request(`/api/session-drafts/${draft.id}/complete`,{method:'POST',cookie,body:{expectedRevision:1,session:completePayload()}});assert.equal(result.response.status,200);assert.equal(result.json.session.id,sessionId);
  assert.equal((await request('/api/session-drafts?clientId=c1',{cookie})).json.drafts.length,0);
  const stored=JSON.parse(await readFile(process.env.DB_PATH,'utf8'));assert.equal(stored.sessions.length,1);assert.equal(stored.sessions[0].id,sessionId);assert.equal(stored.sessions[0].finalized,false);
  assert.equal(stored.auditLog.filter(item=>item.action==='session-created').length,1);
});

test('drafts never enter completed-session API consumers',async()=>{
  const cookie=await login();await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}});
  const sessions=await request('/api/sessions?clientId=c1',{cookie});assert.deepEqual(sessions.json.sessions,[]);
  const stored=JSON.parse(await readFile(process.env.DB_PATH,'utf8'));assert.deepEqual(stored.sessions,[]);
});

test('explicit logout and reauthentication retain an acknowledged draft',async()=>{
  let cookie=await login();const draft=(await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}})).json;
  assert.equal((await request('/api/auth/logout',{method:'POST',cookie,body:{}})).response.status,200);
  cookie=await login();const resumed=await request(`/api/session-drafts/${draft.id}`,{cookie});
  assert.equal(resumed.response.status,200);assert.equal(resumed.json.id,draft.id);assert.deepEqual(resumed.json.payload.programs[0].responseHistory,['correct','incorrect']);
});


test('owner discard retains audit record and values but removes resumability and completed consumers',async()=>{
  const cookie=await login();
  const draft=(await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}})).json;
  const discarded=await request(`/api/session-drafts/${draft.id}/discard`,{method:'POST',cookie,body:{expectedRevision:1}});
  assert.equal(discarded.response.status,200);
  assert.equal(discarded.json.status,'discarded');assert.equal(discarded.json.discardedBy,draft.ownerUserId);
  assert.ok(Number.isFinite(Date.parse(discarded.json.discardedAt)));assert.equal(discarded.json.revision,2);
  assert.deepEqual(discarded.json.payload,draft.payload);
  assert.deepEqual((await request('/api/session-drafts?clientId=c1',{cookie})).json.drafts,[]);
  assert.equal((await request(`/api/session-drafts/${draft.id}`,{cookie})).response.status,409);
  assert.equal((await request(`/api/session-drafts/${draft.id}`,{method:'PUT',cookie,body:{expectedRevision:2,payload:payload()}})).response.status,409);
  assert.equal((await request(`/api/session-drafts/${draft.id}/complete`,{method:'POST',cookie,body:{expectedRevision:2,session:completePayload()}})).response.status,409);
  const next=await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}});
  assert.equal(next.response.status,201);assert.notEqual(next.json.id,draft.id);
  assert.deepEqual((await request('/api/sessions?clientId=c1',{cookie})).json.sessions,[]);
  const db=JSON.parse(await readFile(process.env.DB_PATH,'utf8'));
  assert.deepEqual(db.sessions,[]); // SOAP/Graphs/report/billing/usage all read completed sessions, not draft storage.
  assert.equal(db.auditLog.filter(item=>item.action==='session-draft-discarded').length,1);
  const store=JSON.parse(await readFile(process.env.SESSION_DRAFT_DB_PATH,'utf8'));
  assert.equal(store.drafts.length,2);assert.deepEqual(store.drafts.find(item=>item.id===draft.id).payload,draft.payload);
});

test('discard refuses foreign owner, stale revisions and completed drafts',async()=>{
  const cookie=await login();const other=await login('bcba','bcba123');
  const draft=(await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}})).json;
  const discard=(owner,revision)=>request(`/api/session-drafts/${draft.id}/discard`,{method:'POST',cookie:owner,body:{expectedRevision:revision}});
  assert.equal((await discard(other,1)).response.status,403);
  const updated=await request(`/api/session-drafts/${draft.id}`,{method:'PUT',cookie,body:{expectedRevision:1,payload:payload()}});
  assert.equal(updated.json.revision,2);
  const stale=await discard(cookie,1);assert.equal(stale.response.status,409);assert.equal(stale.json.draft.status,'in_progress');assert.equal(stale.json.draft.revision,2);
  const completed=await request(`/api/session-drafts/${draft.id}/complete`,{method:'POST',cookie,body:{expectedRevision:2,session:completePayload()}});
  assert.equal(completed.response.status,201);
  assert.equal((await discard(cookie,completed.json.draft.revision)).response.status,409);
  assert.equal((await request('/api/sessions?clientId=c1',{cookie})).json.sessions.length,1);
});

test('simultaneous first saves retain one active draft per owner/client',async()=>{
  const cookie=await login();
  const results=await Promise.all(Array.from({length:3},()=>request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}})));
  assert.equal(new Set(results.map(result=>result.json.id)).size,1);
  assert.equal((await request('/api/session-drafts?clientId=c1',{cookie})).json.drafts.length,1);
});

test('discard requires authentication and races safely with completion',async()=>{
  const cookie=await login();
  const draft=(await request('/api/session-drafts',{method:'POST',cookie,body:{clientId:'c1',payload:payload()}})).json;
  assert.equal((await request(`/api/session-drafts/${draft.id}/discard`,{method:'POST',body:{expectedRevision:1}})).response.status,401);
  const results=await Promise.all([
    request(`/api/session-drafts/${draft.id}/discard`,{method:'POST',cookie,body:{expectedRevision:1}}),
    request(`/api/session-drafts/${draft.id}/complete`,{method:'POST',cookie,body:{expectedRevision:1,session:completePayload()}})
  ]);
  assert.equal(results.filter(result=>result.response.status===409).length,1);
  const store=JSON.parse(await readFile(process.env.SESSION_DRAFT_DB_PATH,'utf8'));
  const db=JSON.parse(await readFile(process.env.DB_PATH,'utf8'));
  assert.equal(db.sessions.length,store.drafts[0].status==='completed'?1:0);
});
