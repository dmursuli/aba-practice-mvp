import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
function extract(name) {
  const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end=app.indexOf('\nfunction ',start+1);
  const asyncEnd=app.indexOf('\nasync function ',start+1);
  return app.slice(start,Math.min(...[end,asyncEnd].filter(n=>n>=0)));
}
const button=()=>({disabled:false,hidden:false,classList:{toggle(){},remove(){},add(){}}});
function harness() {
  const draft={id:'d1',clientId:'c1',status:'in_progress',revision:1,payload:{fields:{notes:'old'}}};
  const h={state:{currentUser:{id:'u1'},durableSessionDraft:null,resumableSessionDraft:null,sessionDraftChecking:false,sessionDraftConflict:false,sessionDraftSaveQueue:Promise.resolve(),sessionDraftSaveToken:1},
    currentClient:()=>({id:'c1'}),sessionCollectionControls:{disabled:false},resumeSessionDraftButton:button(),discardSessionDraftButton:button(),checkSessionDraftButton:button(),
    sessionDraftStatus:{textContent:''},entries:{notes:'new clinical entries',frequency:0},resets:0,applies:0,saves:0,
    window:{confirm:()=>true,clearTimeout(){}},formatDateTime:value=>value,
    listSessionDrafts:async()=>({drafts:[draft]}),createSessionDraft:async()=>({...draft,resumable:true}),
    getSessionDraft:async()=>draft,discardSessionDraft:async()=>({...draft,status:'discarded'}),
    clearSessionDraft(){},clientSelect:{value:'c1'},dateInputValue:()=> '2026-10-14',syncSettingFromClient(){},
  };
  h.form={elements:{date:{value:''}},reset(){h.resets++;h.entries={};}};
  h.applyDurableSessionDraftPayload=()=>{h.applies++;h.entries={notes:'old'};};
  h.saveSessionDraft=()=>{h.saves++;};
  vm.createContext(h);
  for(const name of ['setSessionDraftSaveStatus','updateSessionDraftControls','refreshDurableSessionDraftOffer','persistDurableSessionDraft','resumeDurableSessionDraft','discardDurableSessionDraft']) vm.runInContext(extract(name),h);
  return {h,draft};
}
test('collection is initially disabled and Resume/Discard are outside the disabled fieldset',()=>{
  assert.match(html,/<fieldset id="session-collection-controls" disabled/);
  assert.ok(html.indexOf('id="discard-session-draft"')<html.indexOf('<fieldset id="session-collection-controls"'));
});
test('checking saved sessions and offering an unfinished draft block collection; failed check stays blocked',async()=>{
  const {h}=harness();let resolve;h.listSessionDrafts=()=>new Promise(r=>resolve=r);
  const pending=h.refreshDurableSessionDraftOffer();assert.equal(h.sessionCollectionControls.disabled,true);
  resolve({drafts:[]});await pending;assert.equal(h.sessionCollectionControls.disabled,false);
  h.listSessionDrafts=async()=>{throw new Error('offline');};await h.refreshDurableSessionDraftOffer();assert.equal(h.sessionCollectionControls.disabled,true);
  h.listSessionDrafts=async()=>({drafts:[{id:'old',status:'in_progress'}]});await h.refreshDurableSessionDraftOffer();assert.equal(h.sessionCollectionControls.disabled,true);
});
test('late first-save conflict keeps form values and zeros untouched',async()=>{
  const {h}=harness();const before=structuredClone(h.entries);
  await h.persistDurableSessionDraft({fields:before},1);
  assert.deepEqual(h.entries,before);assert.equal(h.resets,0);assert.equal(h.applies,0);
  assert.equal(h.state.sessionDraftConflict,true);assert.equal(h.sessionCollectionControls.disabled,true);
});
test('late update revision conflict preserves current entries',async()=>{
  const {h,draft}=harness();h.state.durableSessionDraft=draft;
  h.updateSessionDraft=async()=>{throw Object.assign(new Error('conflict'),{status:409,details:{draft:{...draft,revision:2}}});};
  await assert.rejects(h.persistDurableSessionDraft({},1));
  assert.equal(h.entries.notes,'new clinical entries');assert.equal(h.applies,0);assert.equal(h.state.resumableSessionDraft.revision,2);
});
test('discard after late conflict requires confirmation and preserves then saves new entries',async()=>{
  const {h,draft}=harness();h.state.resumableSessionDraft=draft;h.state.sessionDraftConflict=true;
  let calls=0;h.discardSessionDraft=async(id,revision)=>{calls++;assert.equal(id,'d1');assert.equal(revision,1);};
  h.window.confirm=()=>false;await h.discardDurableSessionDraft();assert.equal(calls,0);
  h.window.confirm=message=>{assert.equal(message,'Discard this unfinished session draft? Data collected in this draft will no longer be resumable.');return true;};
  await h.discardDurableSessionDraft();assert.equal(calls,1);assert.equal(h.entries.notes,'new clinical entries');assert.equal(h.entries.frequency,0);
  assert.equal(h.resets,0);assert.equal(h.applies,0);assert.equal(h.saves,1);assert.equal(h.sessionCollectionControls.disabled,false);
});
test('stale discard leaves entries intact and requires a separate confirmation for the newer revision',async()=>{
  const {h,draft}=harness();h.state.resumableSessionDraft=draft;
  let calls=0;h.discardSessionDraft=async()=>{calls++;throw Object.assign(new Error('conflict'),{status:409,details:{draft:{...draft,revision:2}}});};
  await h.discardDurableSessionDraft();assert.equal(calls,1);assert.equal(h.state.resumableSessionDraft.revision,2);
  assert.equal(h.resets,0);assert.equal(h.entries.notes,'new clinical entries');assert.equal(h.sessionCollectionControls.disabled,true);
});
test('resuming requires explicit replacement confirmation; terminal drafts are never applied',async()=>{
  const {h,draft}=harness();h.state.resumableSessionDraft=draft;
  h.window.confirm=()=>false;await h.resumeDurableSessionDraft();assert.equal(h.applies,0);
  h.window.confirm=()=>true;h.getSessionDraft=async()=>({...draft,status:'discarded'});
  await h.resumeDurableSessionDraft();assert.equal(h.applies,0);
  h.getSessionDraft=async()=>draft;await h.resumeDurableSessionDraft();assert.equal(h.applies,1);
});
test('discarding the actively collected draft clears only after successful confirmed discard',async()=>{
  const {h,draft}=harness();h.state.durableSessionDraft=draft;
  await h.discardDurableSessionDraft();assert.equal(h.resets,1);assert.equal(h.state.durableSessionDraft,null);assert.equal(h.saves,0);
});
