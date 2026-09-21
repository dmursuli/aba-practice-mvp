import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-parent-lifecycle-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";
const dbPath = process.env.DB_PATH;
const historicalSession = {
  id: "parent-session-1", clientId: "client-1", serviceType: "parent-training", date: "2026-09-01",
  parentGoals: [{ goalName: "Goal One", targetName: "Target One", opportunities: 5, independent: 4, prompted: 1, fidelity: 80 }]
};
const baseDb = {
  clients: [{
    id: "client-1", name: "Client One", status: "active", agency: "Legacy Agency", defaultSetting: "Home",
    profile: { parentTrainingGoals: [{ goalName: "Goal One", targetName: "Target One", opportunities: 5, independent: 4, prompted: 1, promptLevel: "verbal", fidelity: 80 }] },
    programs: [{ id: "program-1", name: "Unrelated skill", status: "active", targets: [{ id: "target-1", name: "Skill target", status: "active" }] }],
    behaviors: [], planChangeLog: []
  }],
  sessions: [historicalSession], appointments: [], recurringAppointmentSeries: [], providerAvailabilityProfiles: [], providerZoneProfiles: [], historicalImportBatches: [], auditLog: [], users: [], clientUserAssignments: []
};
await writeFile(dbPath, `${JSON.stringify(baseDb, null, 2)}\n`);
const { createAppServer, resetRuntimeState } = await import("../server.js");
let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  resetRuntimeState();
  await new Promise((resolve) => server.close(resolve));
});

async function db() { return JSON.parse(await readFile(dbPath, "utf8")); }
async function request(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : {}, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || "" };
}
async function login(username = "admin", password = "admin123") {
  const result = await request("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(result.response.status, 200);
  return result.cookie;
}
function profile(goals) {
  return { name: "Client One", status: "active", defaultSetting: "Home", parentTrainingGoals: goals };
}

test("Admin and BCBA can persist Parent Training mastery while unauthorized roles remain denied", async () => {
  assert.equal((await request("/api/clients/client-1/profile", { method: "PUT", body: profile([]) })).response.status, 401);
  const admin = await login();
  const mastered = await request("/api/clients/client-1/profile", {
    method: "PUT", cookie: admin,
    body: profile([{ id: "stable-goal", goalName: "Goal One", targetName: "Target One", opportunities: 5, independent: 4, prompted: 1, promptLevel: "verbal", status: "mastered", masteredDate: "2026-09-21" }])
  });
  assert.equal(mastered.response.status, 200);
  assert.deepEqual(mastered.json.profile.parentTrainingGoals[0], {
    id: "stable-goal", goalName: "Goal One", targetName: "Target One", opportunities: 5, independent: 4, prompted: 1, promptLevel: "verbal", fidelity: 80, status: "mastered", masteredDate: "2026-09-21"
  });
  assert.deepEqual((await db()).sessions[0].parentGoals, historicalSession.parentGoals);
  assert.equal((await db()).clients[0].programs[0].targets[0].status, "active");
  assert.equal((await request("/api/clients/client-1/profile", { method: "PUT", cookie: await login("bcba", "bcba123"), body: profile(mastered.json.profile.parentTrainingGoals) })).response.status, 200);
  assert.equal((await request("/api/clients/client-1/profile", { method: "PUT", cookie: await login("rbt", "rbt123"), body: profile([]) })).response.status, 403);
  assert.equal((await request("/api/clients/client-1/profile", { method: "PUT", cookie: await login("readonly", "readonly123"), body: profile([]) })).response.status, 403);
});

test("legacy lifecycle fields remain readable and backup/restore preserves Parent Training goals", async () => {
  const admin = await login();
  const result = await request("/api/clients/client-1/profile", {
    method: "PUT", cookie: admin,
    body: profile([
      { goalName: "Legacy mastered", targetName: "Legacy target", opportunities: 5, independent: 5, prompted: 0, mastered: true, masteredAt: "2026-08-15T10:00:00.000Z" },
      { goalName: "Legacy active", targetName: "Active target", opportunities: 5, independent: 2, prompted: 3 }
    ])
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.profile.parentTrainingGoals[0].mastered, true);
  assert.equal(result.json.profile.parentTrainingGoals[0].masteredAt, "2026-08-15T10:00:00.000Z");
  assert.equal("status" in result.json.profile.parentTrainingGoals[1], false);

  const backup = await request("/api/backup", { cookie: admin });
  assert.equal(backup.response.status, 200);
  const restore = await request("/api/backup/restore", { method: "POST", cookie: admin, body: backup.json });
  assert.equal(restore.response.status, 200);
  assert.deepEqual((await db()).clients[0].profile.parentTrainingGoals, result.json.profile.parentTrainingGoals);
  assert.deepEqual((await db()).sessions[0].parentGoals, historicalSession.parentGoals);
});
