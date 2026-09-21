import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-provider-matching-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";
const dbPath = process.env.DB_PATH;

const location = (id, zone = "Kendall") => ({
  id,
  name: "Home",
  settingType: "home",
  zone,
  isPrimary: true,
  isActive: true,
  address: { line1: "", line2: "", city: "", state: "FL", postalCode: "" }
});
const baseDb = {
  clients: [
    { id: "client-1", name: "Client One", status: "active", agency: "Legacy Client Agency", profile: { serviceLocations: [location("location-1")] }, programs: [], behaviors: [] },
    { id: "client-2", name: "Client Two", status: "active", agency: "Other Legacy Agency", profile: { serviceLocations: [location("location-2", "Doral")] }, programs: [], behaviors: [] }
  ],
  sessions: [],
  appointments: [],
  recurringAppointmentSeries: [],
  providerAvailabilityProfiles: [],
  providerZoneProfiles: [],
  historicalImportBatches: [],
  auditLog: [],
  users: [],
  clientUserAssignments: []
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

async function resetDb(next = baseDb) {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify(structuredClone(next), null, 2)}\n`);
}
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
function criteria(overrides = {}) {
  return {
    clientId: "client-1",
    cptCode: "97153",
    serviceLocationId: "location-1",
    date: "2026-09-21",
    startTime: "09:00",
    endTime: "10:00",
    timezone: "America/New_York",
    ...overrides
  };
}
async function match(cookie, body = criteria()) {
  return request("/api/scheduling/provider-matches", { method: "POST", cookie, body });
}

test("Admin and BCBA may match organization-wide while RBT, read-only, and anonymous users are denied", async () => {
  await resetDb();
  const admin = await login();
  const state = await db();
  state.users.find((user) => user.id === "user-admin").agency = "Admin Legacy Agency";
  state.users.find((user) => user.id === "user-rbt").agency = "Provider Legacy Agency";
  await writeFile(dbPath, `${JSON.stringify(state, null, 2)}\n`);
  const before = await db();
  const adminResult = await match(admin);
  assert.equal(adminResult.response.status, 200);
  assert.equal(adminResult.json.groups.flatMap((group) => group.candidates).length, 1);
  assert.equal(adminResult.json.groups.flatMap((group) => group.candidates)[0].provider.role, "rbt");
  assert.deepEqual((await db()).clientUserAssignments, []);
  assert.deepEqual(await db(), before);

  assert.equal((await match(await login("bcba", "bcba123"))).response.status, 200);
  assert.equal((await match(await login("rbt", "rbt123"))).response.status, 403);
  assert.equal((await match(await login("readonly", "readonly123"))).response.status, 403);
  assert.equal((await match("")).response.status, 401);
});

test("matching validates active client, owned active location, CPT, local interval, and timezone", async () => {
  await resetDb();
  const admin = await login();
  for (const [overrides, pattern] of [
    [{ clientId: "missing" }, /existing client/],
    [{ serviceLocationId: "missing" }, /active service location/],
    [{ serviceLocationId: "location-2" }, /belonging to the selected client/],
    [{ cptCode: "99999" }, /97151, 97153, 97155, or 97156/],
    [{ date: "2026-02-30" }, /valid YYYY-MM-DD/],
    [{ startTime: "25:00" }, /Start time/],
    [{ endTime: "09:00" }, /after start time/],
    [{ startTime: "22:00", endTime: "06:00" }, /cross-midnight/],
    [{ timezone: "Eastern Time" }, /valid IANA timezone/]
  ]) {
    const result = await match(admin, criteria(overrides));
    assert.equal(result.response.status, 400);
    assert.match(result.json.errors.join(" "), pattern);
  }

  const inactiveState = await db();
  inactiveState.clients[0].status = "archived";
  await writeFile(dbPath, `${JSON.stringify(inactiveState, null, 2)}\n`);
  const inactive = await match(admin);
  assert.equal(inactive.response.status, 400);
  assert.match(inactive.json.errors.join(" "), /Client must be active/);
});

test("matching returns normalized context, preserves legacy zones, and never persists results", async () => {
  const legacyState = structuredClone(baseDb);
  legacyState.clients[0].profile.serviceLocations[0].zone = "Tamiami";
  await resetDb(legacyState);
  const admin = await login();
  const before = await db();
  const result = await match(admin);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.context.serviceLocation.zone, "Tamiami");
  assert.equal(result.json.context.serviceLocation.hasCurrentOperationalZone, false);
  assert.ok(result.json.context.scheduledStartAt.endsWith("-04:00"));
  assert.ok(result.json.groups.flatMap((group) => group.candidates).every((item) => item.zone.status === "service_zone_not_current"));
  assert.deepEqual(await db(), before);
});
