import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ensurePostgresSessionDraftSchema} from '../lib/session-draft-store.mjs';
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const api=await readFile(new URL('../public/api.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
const pg=await readFile(new URL('../lib/session-draft-store.mjs',import.meta.url),'utf8');
test('97153 UI has explicit resume/finish status and serialized hybrid autosave',()=>{
  assert.match(html,/id="session-draft-status"[^>]*aria-live="polite"/);assert.match(html,/id="resume-session-draft"/);assert.match(html,/Finish session and generate SOAP note/);
  assert.match(app,/sessionDraftSaveQueue = state\.sessionDraftSaveQueue\.catch/);assert.match(app,/window\.setTimeout\(run,700\)/);assert.match(app,/saveSessionDraft\(\{ immediate:true,forceStart:true \}\)/);
  assert.match(app,/setSessionDraftSaveStatus\("saving"/);assert.match(app,/setSessionDraftSaveStatus\("saved"/);assert.match(app,/setSessionDraftSaveStatus\("error"/);
});
test('resume restores aggregate and undo history while legacy recovery cannot compete',()=>{
  assert.match(app,/row\.responseHistory = Array\.isArray\(values\.responseHistory\)/);assert.match(app,/getSessionDraft\(offered\.id\)/);assert.match(app,/Durable 97153 drafts are offered explicitly/);
  assert.match(app,/preserveDrafts\(\{ \.\.\.state\.draftCache, session:\{\} \}\)/);assert.doesNotMatch(app,/state\.draftCache\.session = \{ \.\.\.state\.draftCache\.session, \.\.\.drafts\.session \}/);
});
test('completion flushes the acknowledged revision and does not change 97156 submit',()=>{
  assert.match(app,/await flushDurableSessionDraft\(\)/);assert.match(app,/completeSessionDraft\(draft\.id,draft\.revision,payload\)/);
  assert.match(app,/async function handleParentTrainingSubmit[\s\S]*?createSession\(payload\)/);
  assert.match(server,/sourceDraftId/);assert.match(server,/sessionDraftCompletionLocks/);
});
test('PostgreSQL uses additive draft storage and transaction locks',()=>{
  assert.match(pg,/create table if not exists session_drafts/);assert.match(pg,/owner_user_id/);assert.match(pg,/revision integer/);assert.match(pg,/completed_session_id/);
  assert.match(pg,/select \* from session_drafts where id=\$1 for update/);assert.match(pg,/select data from app_state where id='main' for update/);assert.match(pg,/begin/);assert.match(pg,/commit/);assert.match(pg,/rollback/);
});
test('PostgreSQL schema creation executes the additive draft table and index statements',async()=>{
  const statements=[];await ensurePostgresSessionDraftSchema({query:async sql=>{statements.push(String(sql));return {rows:[]};}});
  assert.equal(statements.length,2);assert.match(statements[0],/create table if not exists session_drafts/);assert.match(statements[1],/create index if not exists session_drafts_owner_status_idx/);
});
test('draft API is separate from completed sessions and enforces access/revisions',()=>{
  for(const method of ['listSessionDrafts','createSessionDraft','getSessionDraft','updateSessionDraft','completeSessionDraft']) assert.match(api,new RegExp(`function ${method}\\(`));
  assert.match(server,/draft\.ownerUserId !== auth\.user\.id/);assert.match(server,/DRAFT_CONFLICT/);assert.match(server,/status === "in_progress"/);
});
