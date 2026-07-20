import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  format97155TargetChangeSummary,
  planChangesFor97155Session,
  summarize97155TargetChanges
} from "../public/soap.js";

process.env.DB_PATH = process.env.DB_PATH || join(await mkdtemp(join(tmpdir(), "aba-soap-integration-test-")), "db.json");
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
  sessions: [],
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

test("97155 SOAP reads target-status changes persisted through the treatment-plan endpoint", async () => {
  await resetDb();
  const cookie = await loginAs();
  const dataBefore = await request("/api/data?includeSessions=visible", { cookie });
  assert.equal(dataBefore.response.status, 200);
  const clientBefore = dataBefore.json.clients.find((client) => client.id === "client-1");
  const programs = structuredClone(clientBefore.programs);
  programs[0].targets[0].status = "mastered";
  programs[0].targets[0].maintenanceDate = "2026-07-12";

  const sessionContext = {
    clientId: "client-1",
    sessionId: "97155-session-1",
    sessionDate: "2026-07-12",
    serviceCode: "97155",
    context: "treatment-planning"
  };
  const planChangeLog = [
    ...clientBefore.planChangeLog,
    {
      id: "change-1",
      ...sessionContext,
      date: "2026-07-12",
      timestamp: "2026-07-12T15:00:00.000Z",
      type: "target-status-changed",
      domain: "Functional Communication",
      programId: "program-1",
      programName: "Manding",
      targetId: "target-1",
      targetName: "Request help",
      fromStatus: "active",
      toStatus: "mastered"
    }
  ];

  const saveResult = await request("/api/clients/client-1/plan", {
    method: "PUT",
    cookie,
    body: {
      domains: clientBefore.domains,
      programs,
      behaviors: clientBefore.behaviors,
      rbtPerformanceAreas: clientBefore.rbtPerformanceAreas,
      planChangeLog,
      note97151: clientBefore.note97151,
      note97155: clientBefore.note97155,
      note97151History: clientBefore.note97151History,
      note97155History: clientBefore.note97155History
    }
  });
  assert.equal(saveResult.response.status, 200);

  const persisted = saveResult.json.planChangeLog.find((entry) => entry.id === "change-1");
  assert.deepEqual({
    clientId: persisted.clientId,
    sessionId: persisted.sessionId,
    sessionDate: persisted.sessionDate,
    serviceCode: persisted.serviceCode,
    context: persisted.context,
    targetId: persisted.targetId,
    fromStatus: persisted.fromStatus,
    toStatus: persisted.toStatus
  }, {
    ...sessionContext,
    targetId: "target-1",
    fromStatus: "active",
    toStatus: "mastered"
  });

  const latestData = await request("/api/data?includeSessions=visible", { cookie });
  const latestClient = latestData.json.clients.find((client) => client.id === "client-1");
  const matched = planChangesFor97155Session(latestClient.planChangeLog, sessionContext);
  const summary = format97155TargetChangeSummary(summarize97155TargetChanges(matched));

  assert.equal(matched.length, 1);
  assert.match(summary, /Targets mastered included Manding: Request help\./);
});

test("SOAP draft, finalize, and amend workflow preserves the finalized session note", async () => {
  await resetDb({
    ...structuredClone(baseDb),
    sessions: [
      {
        id: "session-1",
        clientId: "client-1",
        date: "2026-07-10",
        therapist: "Diego Mursuli",
        startTime: "09:00",
        endTime: "10:00",
        setting: "Home",
        caregiverPresent: false,
        rbtPresent: false,
        programs: [],
        behaviors: [],
        barriers: "none",
        serviceType: "97153",
        providerSignature: "Diego Mursuli",
        providerCredential: "BCBA",
        soapNote: "S: Original draft\n\nO: Data reviewed\n\nA: Progress noted\n\nP: Continue plan",
        finalized: false,
        noteStatus: "draft",
        createdAt: "2026-07-10T13:00:00.000Z"
      }
    ]
  });
  const cookie = await loginAs();

  const draft = await request("/api/sessions/session-1/note", {
    method: "PUT",
    cookie,
    body: {
      action: "save-draft",
      soapNote: "S: Edited draft\n\nO: Data reviewed\n\nA: Progress noted\n\nP: Continue plan",
      date: "2026-07-11",
      startTime: "09:15",
      endTime: "10:15",
      setting: "Clinic",
      caregiverPresent: true,
      rbtPresent: false,
      providerSignature: "Diego Mursuli",
      providerCredential: "BCBA"
    }
  });
  assert.equal(draft.response.status, 200);
  assert.equal(draft.json.noteStatus, "draft");
  assert.equal(draft.json.finalized, false);
  assert.equal(draft.json.date, "2026-07-11");
  assert.match(draft.json.soapNote, /Edited draft/);

  const finalized = await request("/api/sessions/session-1/note", {
    method: "PUT",
    cookie,
    body: {
      action: "finalize",
      soapNote: draft.json.soapNote,
      date: "2026-07-11",
      startTime: "09:15",
      endTime: "10:15",
      setting: "Clinic",
      caregiverPresent: true,
      rbtPresent: false,
      providerSignature: "Diego Mursuli",
      providerCredential: "BCBA",
      signatureDate: "2026-07-11"
    }
  });
  assert.equal(finalized.response.status, 200);
  assert.equal(finalized.json.noteStatus, "finalized");
  assert.equal(finalized.json.finalized, true);
  assert.match(finalized.json.finalizedSnapshot.soapNote, /Edited draft/);

  const blocked = await request("/api/sessions/session-1/note", {
    method: "PUT",
    cookie,
    body: {
      action: "save-draft",
      soapNote: "S: Silent overwrite attempt",
      date: "2026-07-12",
      startTime: "09:15",
      endTime: "10:15"
    }
  });
  assert.equal(blocked.response.status, 409);

  const missingReason = await request("/api/sessions/session-1/note", {
    method: "PUT",
    cookie,
    body: {
      action: "amend",
      soapNote: "S: Corrected note",
      date: "2026-07-12",
      startTime: "09:15",
      endTime: "10:15"
    }
  });
  assert.equal(missingReason.response.status, 400);

  const amended = await request("/api/sessions/session-1/note", {
    method: "PUT",
    cookie,
    body: {
      action: "amend",
      soapNote: "S: Corrected note\n\nO: Data reviewed\n\nA: Progress noted\n\nP: Continue plan",
      date: "2026-07-12",
      startTime: "09:15",
      endTime: "10:15",
      setting: "Clinic",
      caregiverPresent: true,
      rbtPresent: false,
      providerSignature: "Diego Mursuli",
      providerCredential: "BCBA",
      signatureDate: "2026-07-12",
      amendmentReason: "Corrected service date after documentation review."
    }
  });
  assert.equal(amended.response.status, 200);
  assert.equal(amended.json.noteStatus, "amended");
  assert.equal(amended.json.finalized, true);
  assert.equal(amended.json.date, "2026-07-12");
  assert.match(amended.json.finalizedSnapshot.soapNote, /Edited draft/);
  assert.equal(amended.json.amendments.length, 1);
  assert.match(amended.json.amendments[0].reason, /Corrected service date/);
});

test("97155 SOAP note history keeps draft status and treats unknown legacy status as finalized", async () => {
  await resetDb();
  const cookie = await loginAs();
  const dataBefore = await request("/api/data?includeSessions=visible", { cookie });
  assert.equal(dataBefore.response.status, 200);
  const clientBefore = dataBefore.json.clients.find((client) => client.id === "client-1");

  const saveResult = await request("/api/clients/client-1/plan", {
    method: "PUT",
    cookie,
    body: {
      domains: clientBefore.domains,
      programs: clientBefore.programs,
      behaviors: clientBefore.behaviors,
      rbtPerformanceAreas: clientBefore.rbtPerformanceAreas,
      planChangeLog: clientBefore.planChangeLog,
      note97151: clientBefore.note97151,
      note97155: "S: Draft 97155\n\nO: Data reviewed\n\nA: Progress noted\n\nP: Continue",
      note97151History: [],
      note97155History: [
        {
          id: "draft-97155",
          sessionId: "97155-session-2",
          serviceCode: "97155",
          note: "S: Draft 97155\n\nO: Data reviewed\n\nA: Progress noted\n\nP: Continue",
          date: "2026-07-14",
          status: "draft",
          noteStatus: "draft",
          finalized: false,
          lastSavedAt: "2026-07-14T15:00:00.000Z"
        },
        {
          id: "legacy-unknown-status",
          sessionId: "97155-session-1",
          serviceCode: "97155",
          note: "S: Legacy saved note",
          date: "2026-07-13"
        }
      ]
    }
  });

  assert.equal(saveResult.response.status, 200);
  const draft = saveResult.json.note97155History.find((entry) => entry.id === "draft-97155");
  const legacy = saveResult.json.note97155History.find((entry) => entry.id === "legacy-unknown-status");
  assert.equal(draft.noteStatus, "draft");
  assert.equal(draft.finalized, false);
  assert.equal(legacy.noteStatus, "finalized");
  assert.equal(legacy.finalized, true);
  assert.match(legacy.finalizedBy, /migration/);
});
