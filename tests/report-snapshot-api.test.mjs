import { sanitizeClinicalSnapshot } from "../public/report-snapshot.js";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-report-snapshot-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";

const dbPath = process.env.DB_PATH;

const baseDb = {
  clients: [
    {
      id: "client-1",
      name: "Sample Client",
      agency: "Triumph ABA",
      status: "active",
      defaultSetting: "home",
      domains: ["Functional Communication"],
      programs: [
        {
          id: "program-1",
          name: "Manding",
          domain: "Functional Communication",
          objective: "Request help when materials are unavailable.",
          status: "active",
          targets: [
            { id: "target-1", name: "Request help", status: "active" }
          ]
        }
      ],
      behaviors: [],
      planChangeLog: [],
      note97155: "",
      note97155History: [],
      profile: { documents: [] }
    }
  ],
  sessions: [{id:"session-original",clientId:"client-1",date:"2026-03-01",skills:[{programId:"program-1",targetId:"target-1",correct:0,total:5}],behaviors:[{behaviorId:"b",frequency:0}]}],
  historicalImportBatches: [],
  auditLog: [],
  users: []
};

await writeFile(dbPath, `${JSON.stringify(baseDb, null, 2)}\n`, "utf8");

const { createAppServer, resetRuntimeState } = await import("../server.js");

let server;
let baseUrl = "";

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  resetRuntimeState();
  await new Promise((resolve) => server.close(resolve));
});

async function resetDb(nextDb = baseDb) {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify(nextDb, null, 2)}\n`, "utf8");
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }
  return {
    response,
    json,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || ""
  };
}

async function loginAs(identifier = "admin", password = "admin123") {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { username: identifier, password }
  });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

function snapshot(name='Original') {
  return {version:1,clientId:'client-1',capturedBy:'forged',capturedAt:'1900-01-01',clientName:name,preparationDate:'2026-04-01',reportingPeriod:{startDate:'2026-01-01',endDate:'2026-03-31'},programs:[{id:'p',name,objective:'Original objective',targets:[{id:'t',name:'Target',status:'mastered',maintenanceDate:'2026-03-01'}]}],behaviors:[{id:'b',name:'Behavior',status:'inactive'}],caregiverGoals:[{id:'g',goalName:'Caregiver',status:'active'}],masteryCriteria:{thresholdPercent:90},phases:{'skill:p':{treatmentPhaseLine:{date:'2026-02-01'},phaseMarkers:[{date:'2026-03-01',label:'Mastered',detail:'Target'}]}},sessions:[{secret:'must not persist'}]};
}
async function save(cookie,report) {
  return request('/api/clients/client-1/profile',{method:'PUT',cookie,body:{name:'Sample Client',funderReport:report}});
}
test('capture, ordinary save, live plan edits, refresh and audit round-trip without copying observations',async()=>{
  await resetDb();const cookie=await loginAs();
  const before=JSON.parse(await readFile(dbPath,'utf8')).sessions;
  let result=await save(cookie,{background:'Manual narrative',metadata:{generatedSectionAutofill:{background:'Original generated text'}},startDate:'2026-01-01',clinicalSnapshotAction:'capture',clinicalSnapshot:snapshot()});
  assert.equal(result.response.status,200);
  let report=result.json.profile.funderReport;
  const captured=structuredClone(report.clinicalSnapshot);
  assert.equal(report.metadata.generatedSectionAutofill.background,'Original generated text');
  assert.notEqual(captured.capturedBy,'forged');assert.notEqual(captured.capturedAt,'1900-01-01');
  assert.equal(captured.sessions,undefined);assert.equal(captured.programs[0].targets[0].programId,'p');
  assert.equal(captured.behaviors[0].status,'inactive');assert.equal(captured.caregiverGoals[0].goalName,'Caregiver');
  const plan=await request('/api/clients/client-1/plan',{method:'PUT',cookie,body:{programs:[{id:'p',name:'Changed live',objective:'Changed',targets:[]}],behaviors:[{id:'b',name:'Renamed',status:'active'}]}});
  assert.equal(plan.response.status,200);
  result=await save(cookie,{...report,background:'Edited manual narrative',clinicalSnapshot:snapshot('Unrequested refresh')});
  assert.deepEqual(result.json.profile.funderReport.clinicalSnapshot,captured);
  assert.equal(result.json.profile.funderReport.background,'Edited manual narrative');
  report=result.json.profile.funderReport;
  result=await save(cookie,{...report,clinicalSnapshotAction:'refresh',clinicalSnapshot:snapshot('Refreshed')});
  assert.equal(result.json.profile.funderReport.clinicalSnapshot.clientName,'Refreshed');
  assert.equal(result.json.profile.funderReport.background,'Edited manual narrative');
  const refreshed=result.json.profile.funderReport;
  const unrelated=await request('/api/clients/client-1/profile',{method:'PUT',cookie,body:{name:'Renamed live client'}});
  assert.equal(unrelated.response.status,200);
  assert.deepEqual(unrelated.json.profile.funderReport,refreshed);
  const stored=JSON.parse(await readFile(dbPath,'utf8'));
  assert.deepEqual(stored.clients[0].profile.funderReport.clinicalSnapshot,refreshed.clinicalSnapshot);
  assert.equal(before.length,1);
  assert.deepEqual(stored.sessions,before);
  assert.deepEqual(stored.auditLog.filter(e=>e.details?.reportClinicalSnapshot).map(e=>e.details.reportClinicalSnapshot.action).sort(),['capture','refresh']);
});
test('legacy saves never silently backfill; refresh requires existing authorization',async()=>{
  const db=structuredClone(baseDb);db.clients[0].profile.funderReport={background:'Legacy text'};
  await resetDb(db);const cookie=await loginAs();
  let result=await save(cookie,{background:'Legacy text',clinicalSnapshotAction:'capture',clinicalSnapshot:snapshot()});
  assert.equal(result.response.status,200);assert.equal(result.json.profile.funderReport.clinicalSnapshot,undefined);
  assert.equal(result.json.profile.funderReport.background,'Legacy text');
  result=await save('',{clinicalSnapshotAction:'refresh',clinicalSnapshot:snapshot()});
  assert.ok([401,403].includes(result.response.status));
  // Persisted role changes are authoritative even for an existing authenticated cookie.
  const stored=JSON.parse(await readFile(dbPath,'utf8'));
  stored.users.find(u=>u.username==='admin').role='read-only';
  await writeFile(dbPath,JSON.stringify(stored));
  result=await save(cookie,{clinicalSnapshotAction:'refresh',clinicalSnapshot:snapshot()});
  assert.equal(result.response.status,403);
});

test('saved assessment removals survive persistence and reopening without deleting client documents or snapshot',async()=>{
  const db=structuredClone(baseDb);
  db.clients[0].profile.documents=[{id:'a',type:'fba-assessment',fileName:'a.png'},{id:'b',type:'fba-assessment',fileName:'b.jpg'},{id:'std',type:'standardized-assessment',fileName:'std.pdf'},{id:'other',type:'other',fileName:'other.pdf'}];
  await resetDb(db);const cookie=await loginAs();
  const ref=id=>({fileId:id,originalFileName:id+'.png',contentType:'image/png'});
  let result=await save(cookie,{background:'Manual',clinicalSnapshotAction:'capture',clinicalSnapshot:snapshot(),assessmentDocuments:{assessmentGrid:[ref('a'),ref('b')],standardizedAssessmentGrid:[ref('std')]}});
  assert.equal(result.response.status,200);
  const captured=structuredClone(result.json.profile.funderReport.clinicalSnapshot);
  const documents=structuredClone(result.json.profile.documents);
  for(const remaining of [['b'],[]]) {
    const report=result.json.profile.funderReport;
    result=await save(cookie,{...report,assessmentDocuments:{...report.assessmentDocuments,assessmentGrid:remaining.map(ref)}});
    assert.equal(result.response.status,200);
    const stored=JSON.parse(await readFile(dbPath,'utf8')).clients[0].profile;
    assert.deepEqual(stored.funderReport.assessmentDocuments.assessmentGrid.map(r=>r.fileId),remaining);
    assert.deepEqual(stored.funderReport.assessmentDocuments.standardizedAssessmentGrid.map(r=>r.fileId),['std']);
    assert.deepEqual(stored.documents,documents);
    assert.deepEqual(stored.funderReport.clinicalSnapshot,captured);
  }
  result=await save(cookie,{...result.json.profile.funderReport,assessmentDocuments:{assessmentGrid:[],standardizedAssessmentGrid:[]}});
  assert.deepEqual(result.json.profile.funderReport.assessmentDocuments,{assessmentGrid:[],standardizedAssessmentGrid:[]});
  assert.deepEqual(result.json.profile.documents,documents);
});
