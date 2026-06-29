import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = process.env.DB_PATH || join(await mkdtemp(join(tmpdir(), "aba-import-test-")), "db.json");
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
          status: "active",
          targets: [{ id: "target-1", name: "Request help", status: "active" }]
        }
      ],
      behaviors: [{ id: "behavior-1", name: "Aggression", status: "active" }],
      profile: {
        documents: [],
        parentTrainingGoals: [{ goalName: "Use visual schedule", targetName: "Prompt schedule before transitions" }]
      }
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

test("admin can import a historical skill batch and roll it back", async () => {
  resetRuntimeState();
  await resetDb();
  const cookie = await loginAs();
  const importResult = await request("/api/historical-imports", {
    method: "POST",
    cookie,
    body: {
      clientId: "client-1",
      dataType: "skill",
      measurementType: "percentage",
      selectedReference: {
        id: "target-1"
      },
      duplicateStrategy: "skip",
      rows: [
        {
          date: "2026-01-15",
          dataType: "skill",
          value: 80,
          denominator: 10,
          phase: "baseline",
          setting: "home",
          notes: "Backfilled from paper graph"
        }
      ]
    }
  });
  assert.equal(importResult.response.status, 201);
  assert.equal(importResult.json.results.created, 1);

  const dataResult = await request("/api/data?includeSessions=visible", { cookie });
  assert.equal(dataResult.response.status, 200);
  assert.equal(dataResult.json.sessions.length, 1);
  assert.equal(dataResult.json.sessions[0].source, "historical_import");
  assert.equal(dataResult.json.historicalImportBatches.length, 1);
  assert.equal(dataResult.json.sessions[0].programs[0].targets[0].targetId, "target-1");
  assert.equal(dataResult.json.historicalImportBatches[0].selectedReferenceId, "target-1");

  const rollback = await request(`/api/historical-imports/${importResult.json.batchId}`, {
    method: "DELETE",
    cookie
  });
  assert.equal(rollback.response.status, 200);

  const afterRollback = await request("/api/data?includeSessions=visible", { cookie });
  assert.equal(afterRollback.json.sessions.length, 0);
  assert.equal(afterRollback.json.historicalImportBatches[0].status, "rolled_back");
});

test("bootstrap data omits session payloads while preserving per-client counts", async () => {
  resetRuntimeState();
  await resetDb({
    ...baseDb,
    sessions: [
      { id: "s-1", clientId: "client-1", date: "2026-01-15", programs: [], behaviors: [], parentGoals: [] },
      { id: "s-2", clientId: "client-1", date: "2026-01-16", programs: [], behaviors: [], parentGoals: [] }
    ]
  });
  const cookie = await loginAs();
  const result = await request("/api/data", { cookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.sessions, []);
  assert.equal(result.json.clientSessionCounts["client-1"], 2);
});

test("client sessions endpoint returns only the requested client's filtered sessions", async () => {
  resetRuntimeState();
  await resetDb({
    ...baseDb,
    clients: [...baseDb.clients, { ...baseDb.clients[0], id: "client-2", name: "Other Client" }],
    sessions: [
      { id: "s-1", clientId: "client-1", date: "2026-01-15", serviceType: "97153", programs: [], behaviors: [], parentGoals: [] },
      { id: "s-2", clientId: "client-1", date: "2026-03-10", serviceType: "97153", programs: [], behaviors: [], parentGoals: [] },
      { id: "s-3", clientId: "client-2", date: "2026-03-10", serviceType: "97153", programs: [], behaviors: [], parentGoals: [] }
    ]
  });
  const cookie = await loginAs();
  const result = await request("/api/clients/client-1/sessions?startDate=2026-03-01&endDate=2026-03-31", { cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.scope, "client");
  assert.equal(result.json.clientId, "client-1");
  assert.equal(result.json.sessions.length, 1);
  assert.equal(result.json.sessions[0].id, "s-2");
});

test("update duplicate strategy edits an existing imported point and rollback restores the prior value", async () => {
  resetRuntimeState();
  await resetDb({
    ...baseDb,
    sessions: [
      {
        id: "session-import-1",
        clientId: "client-1",
        date: "2026-01-15",
        therapist: "Historical import",
        startTime: "00:00",
        endTime: "00:00",
        setting: "home",
        caregiverPresent: false,
        affect: "neutral",
        transitions: "typical",
        programs: [{
          programId: "program-1",
          targets: [{
            targetId: "target-1",
            trials: 10,
            correct: 5,
            incorrect: 5,
            promptLevel: "historical import",
            phase: "intervention",
            independence: 50,
            historicalImportMeasurementType: "percentage",
            historicalImportBatchId: "old-batch"
          }]
        }],
        behaviors: [],
        barriers: "none",
        barrierText: "",
        caregiverTraining: false,
        notes: "Historical data import",
        serviceType: "97153",
        parentTraining: null,
        parentGoals: [],
        providerSignature: "Historical import",
        providerCredential: "BCBA",
        soapNote: "",
        finalized: false,
        agency: "Triumph ABA",
        source: "historical_import",
        historicalImport: {
          source: "historical_import",
          batchId: "old-batch",
          importedAt: "2026-01-16T00:00:00.000Z",
          importedBy: "user-1"
        },
        createdAt: "2026-01-16T00:00:00.000Z",
        updatedAt: "2026-01-16T00:00:00.000Z"
      }
    ],
    historicalImportBatches: []
  });
  const cookie = await loginAs();
  const importResult = await request("/api/historical-imports", {
    method: "POST",
    cookie,
    body: {
      clientId: "client-1",
      dataType: "skill",
      measurementType: "percentage",
      selectedReference: {
        id: "target-1"
      },
      duplicateStrategy: "replace",
      rows: [
        {
          date: "2026-01-15",
          dataType: "skill",
          value: 90,
          denominator: 10,
          phase: "intervention",
          setting: "home",
          notes: "Corrected score"
        }
      ]
    }
  });
  assert.equal(importResult.response.status, 201);
  assert.equal(importResult.json.results.updated, 1);

  const afterUpdate = await request("/api/data?includeSessions=visible", { cookie });
  assert.equal(afterUpdate.json.sessions.length, 1);
  assert.equal(afterUpdate.json.sessions[0].programs[0].targets[0].independence, 90);

  const rollback = await request(`/api/historical-imports/${importResult.json.batchId}`, {
    method: "DELETE",
    cookie
  });
  assert.equal(rollback.response.status, 200);

  const afterRollback = await request("/api/data?includeSessions=visible", { cookie });
  assert.equal(afterRollback.json.sessions[0].programs[0].targets[0].independence, 50);
});

test("rbt users cannot import historical data", async () => {
  resetRuntimeState();
  await resetDb();
  const cookie = await loginAs("rbt", "rbt123");
  const result = await request("/api/historical-imports", {
    method: "POST",
    cookie,
    body: {
      clientId: "client-1",
      dataType: "behavior",
      measurementType: "frequency",
      selectedReference: {
        id: "behavior-1"
      },
      duplicateStrategy: "skip",
      rows: [{
        date: "2026-01-15",
        dataType: "behavior",
        value: 2
      }]
    }
  });
  assert.equal(result.response.status, 403);
});

test("behavior import auto-assigns the selected graph to every csv row and skips invalid rows", async () => {
  resetRuntimeState();
  await resetDb();
  const cookie = await loginAs();
  const importResult = await request("/api/historical-imports", {
    method: "POST",
    cookie,
    body: {
      clientId: "client-1",
      dataType: "behavior",
      measurementType: "frequency",
      selectedReference: {
        id: "behavior-1"
      },
      duplicateStrategy: "skip",
      rows: [
        { date: "3/15/2024", value: 18 },
        { date: "3/16/2024", value: "" },
        { date: "3/17/2024", value: 2 }
      ]
    }
  });
  assert.equal(importResult.response.status, 201);
  assert.equal(importResult.json.results.created, 2);
  assert.equal(importResult.json.results.invalid, 1);
  assert.equal(importResult.json.preview.summary.importableRows, 2);

  const dataResult = await request("/api/clients/client-1/sessions", { cookie });
  assert.equal(dataResult.response.status, 200);
  const importedSessions = dataResult.json.sessions.filter((session) => session.source === "historical_import");
  assert.equal(importedSessions.length, 2);
  assert.ok(importedSessions.every((session) => session.behaviors[0]?.behaviorId === "behavior-1"));
});

test("duplicate strategy cancel blocks duplicate imports without importing any rows", async () => {
  resetRuntimeState();
  await resetDb({
    ...baseDb,
    sessions: [
      {
        id: "session-import-1",
        clientId: "client-1",
        date: "2024-03-15",
        therapist: "Historical import",
        startTime: "00:00",
        endTime: "00:00",
        setting: "home",
        caregiverPresent: false,
        affect: "neutral",
        transitions: "typical",
        programs: [],
        behaviors: [{
          behaviorId: "behavior-1",
          frequency: 4,
          duration: "",
          intensity: "",
          phase: "intervention",
          historicalImportMeasurementType: "frequency",
          historicalImportBatchId: "old-batch"
        }],
        barriers: "none",
        barrierText: "",
        caregiverTraining: false,
        notes: "Historical data import",
        serviceType: "behavior-frequency",
        parentTraining: null,
        parentGoals: [],
        providerSignature: "Historical import",
        providerCredential: "BCBA",
        soapNote: "",
        finalized: false,
        agency: "Triumph ABA",
        source: "historical_import",
        historicalImport: {
          source: "historical_import",
          batchId: "old-batch",
          importedAt: "2026-01-16T00:00:00.000Z",
          importedBy: "user-1"
        },
        createdAt: "2026-01-16T00:00:00.000Z",
        updatedAt: "2026-01-16T00:00:00.000Z"
      }
    ],
    historicalImportBatches: []
  });
  const cookie = await loginAs();
  const result = await request("/api/historical-imports", {
    method: "POST",
    cookie,
    body: {
      clientId: "client-1",
      dataType: "behavior",
      measurementType: "frequency",
      selectedReference: {
        id: "behavior-1"
      },
      duplicateStrategy: "cancel",
      rows: [
        { date: "3/15/2024", value: 6 }
      ]
    }
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.json.preview.rows[0].commitAction, "cancel");
  assert.equal(result.json.preview.summary.importableRows, 0);
});
