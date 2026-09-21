import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-capacity-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";
const dbPath = process.env.DB_PATH;
const baseDb = {
  clients: [{ id: "client-1", name: "Client One", status: "active", agency: "Legacy Client Agency", profile: { serviceLocations: [{ id: "location-1", name: "Home", zone: "Kendall", isPrimary: true, isActive: true }] }, programs: [], behaviors: [] }],
  sessions: [], appointments: [], recurringAppointmentSeries: [], providerAvailabilityProfiles: [], providerZoneProfiles: [], historicalImportBatches: [], auditLog: [], users: [], clientUserAssignments: []
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
async function capacity(cookie, query = "start=2026-09-21&end=2026-09-27") {
  return request(`/api/scheduling/capacity?${query}`, { cookie });
}

test("capacity API is organization-wide and read-only for Admin and BCBA", async () => {
  const admin = await login();
  const state = await db();
  state.users.find((user) => user.id === "user-admin").agency = "Admin Legacy Agency";
  state.users.find((user) => user.id === "user-rbt").agency = "Provider Legacy Agency";
  state.appointments = [{
    id: "appointment-1", clientId: "client-1", agency: "Appointment Legacy Agency", serviceCode: "97153", status: "scheduled",
    scheduledStartAt: "2026-09-21T09:00:00-04:00", scheduledEndAt: "2026-09-21T11:00:00-04:00", timeZone: "America/New_York",
    providerAssignments: [{ userId: "user-rbt", assignmentRole: "primary" }]
  }];
  await writeFile(dbPath, `${JSON.stringify(state, null, 2)}\n`);
  const before = await db();
  const adminResult = await capacity(admin);
  assert.equal(adminResult.response.status, 200);
  assert.equal(adminResult.json.providerCapacity.find((item) => item.provider.userId === "user-rbt").totalBlockingHours, 2);
  assert.equal(adminResult.json.clientCoverage[0].scheduled97153Hours, 2);
  assert.deepEqual(await db(), before);

  const bcbaResult = await capacity(await login("bcba", "bcba123"));
  assert.equal(bcbaResult.response.status, 200);
  assert.equal(bcbaResult.json.range.dayCount, 7);
});

test("capacity API denies RBT, read-only, and anonymous access", async () => {
  assert.equal((await capacity(await login("rbt", "rbt123"))).response.status, 403);
  assert.equal((await capacity(await login("readonly", "readonly123"))).response.status, 403);
  assert.equal((await capacity("")).response.status, 401);
});

test("capacity API validates bounded reporting dates", async () => {
  const admin = await login();
  const missing = await capacity(admin, "start=2026-09-21");
  assert.equal(missing.response.status, 400);
  assert.match(missing.json.errors.join(" "), /end must be a valid/);
  const tooLong = await capacity(admin, "start=2026-09-21&end=2026-10-19");
  assert.equal(tooLong.response.status, 400);
  assert.match(tooLong.json.errors.join(" "), /at most 28 days/);
  const inverted = await capacity(admin, "start=2026-09-28&end=2026-09-21");
  assert.equal(inverted.response.status, 400);
  assert.match(inverted.json.errors.join(" "), /on or after/);
});
