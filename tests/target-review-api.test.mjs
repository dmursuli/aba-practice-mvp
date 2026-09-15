import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-target-review-api-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";

const dbPath = process.env.DB_PATH;
const { createAppServer, resetRuntimeState } = await import("../server.js");

let server;
let baseUrl;

before(async () => {
  await resetDb();
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  resetRuntimeState();
  await new Promise((resolve) => server.close(resolve));
});

async function resetDb() {
  const sessions = Array.from({ length: 1000 }, (_, index) => ({
    id: `history-${index}`,
    clientId: "client-1",
    date: `2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
    startTime: "09:00",
    serviceType: "97153",
    therapist: "Historical Provider",
    soapNote: "Large historical note that must never be returned by the target-review endpoint.",
    programs: [{
      programId: "program-1",
      targets: [{ targetId: "ready", independence: 20 }]
    }],
    behaviors: [{ behaviorId: "behavior-1", frequency: 10 }],
    parentGoals: []
  }));
  sessions.push(
    {
      id: "ready-1",
      clientId: "client-1",
      date: "2026-01-01",
      serviceType: "97153",
      programs: [{ programId: "program-1", targets: [{ targetId: "ready", independence: 95 }] }]
    },
    {
      id: "ready-2",
      clientId: "client-1",
      date: "2026-01-02",
      serviceType: "97153",
      programs: [{ programId: "program-1", targets: [{ targetId: "ready", independence: 95 }] }]
    }
  );
  sessions.push({
    id: "other-client-session",
    clientId: "client-2",
    date: "2026-01-01",
    serviceType: "97153",
    programs: [{ programId: "program-1", targets: [{ targetId: "none", independence: 100 }] }]
  });
  await writeFile(dbPath, `${JSON.stringify({
    clients: [
      {
        id: "client-1",
        name: "Review Client",
        agency: "Triumph ABA",
        profile: {
          masteryCriteria: {
            thresholdPercent: 90,
            consecutiveSessions: 2,
            stagnantConsecutiveSessions: 3,
            stagnantMinimumGain: 5
          }
        },
        programs: [{
          id: "program-1",
          name: "Communication",
          status: "active",
          targets: [
            { id: "mastered", name: "Mastered", status: "mastered" },
            { id: "ready", name: "Ready", status: "active" },
            { id: "none", name: "None", status: "active" }
          ]
        }],
        behaviors: []
      },
      { id: "client-2", name: "Other Client", agency: "Triumph ABA", profile: {}, programs: [], behaviors: [] }
    ],
    sessions,
    auditLog: [],
    users: []
  }, null, 2)}\n`, "utf8");
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: text ? JSON.parse(text) : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || ""
  };
}

async function login(username, password) {
  const response = await request("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(response.status, 200);
  return response.cookie;
}

test("target-review endpoint requires authentication and an Admin or BCBA role", async () => {
  const unauthenticated = await request("/api/clients/client-1/target-reviews");
  assert.equal(unauthenticated.status, 401);

  const readOnlyCookie = await login("readonly", "readonly123");
  const wrongRole = await request("/api/clients/client-1/target-reviews", { cookie: readOnlyCookie });
  assert.equal(wrongRole.status, 403);

  const bcbaCookie = await login("bcba", "bcba123");
  const allowed = await request("/api/clients/client-1/target-reviews", { cookie: bcbaCookie });
  assert.equal(allowed.status, 200);
});

test("target-review endpoint enforces client access and returns compact classifications and exact counts", async () => {
  const adminCookie = await login("admin", "admin123");
  const inaccessible = await request("/api/clients/missing-client/target-reviews", { cookie: adminCookie });
  assert.equal(inaccessible.status, 403);

  const response = await request("/api/clients/client-1/target-reviews", { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.equal(response.json.clientId, "client-1");
  assert.equal(response.json.targets.length, 3);
  assert.deepEqual(response.json.counts, { close: 0, ready: 1, mastered: 1, stagnant: 0, none: 1 });
  assert.equal(response.json.targets.find((target) => target.targetId === "mastered").classification, "mastered");
  assert.equal(response.json.targets.find((target) => target.targetId === "ready").classification, "ready");
  assert.equal(response.json.targets.find((target) => target.targetId === "none").classification, "none");
  assert.ok(response.text.length < 2000);
  assert.doesNotMatch(response.text, /"sessions"|"therapist"|"soapNote"|"behaviors"|"parentGoals"/);
});
