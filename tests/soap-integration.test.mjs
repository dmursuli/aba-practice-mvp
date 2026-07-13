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
