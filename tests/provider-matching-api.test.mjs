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
function appointmentFromMatch(result, candidate) {
  return {
    clientId: result.request.clientId,
    serviceCode: result.request.cptCode,
    providerAssignments: [{ userId: candidate.provider.userId, assignmentRole: "primary" }],
    scheduledStartAt: result.context.scheduledStartAt,
    scheduledEndAt: result.context.scheduledEndAt,
    timeZone: result.request.timezone,
    locationId: result.request.serviceLocationId,
    notes: ""
  };
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
  assert.deepEqual(
    adminResult.json.groups.flatMap((group) => group.candidates).map((candidate) => candidate.provider.role).sort(),
    ["bcba", "rbt"]
  );
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

test("matching reports existing assignment state without changing ranking or persisting results", async () => {
  await resetDb();
  const admin = await login();
  const unassigned = await match(admin);
  const unassignedCandidate = unassigned.json.groups.flatMap((group) => group.candidates)
    .find((candidate) => candidate.provider.role === "rbt");
  const originalGroup = unassignedCandidate.group;
  assert.deepEqual(unassignedCandidate.caseAssignment, { status: "not_assigned", label: "Not assigned" });
  assert.equal(unassigned.json.permissions.canManageClientAssignments, true);

  const state = await db();
  state.clientUserAssignments.push({
    id: "assignment-existing",
    clientId: "client-1",
    userId: unassignedCandidate.provider.userId,
    createdAt: "2026-09-20T12:00:00.000Z",
    createdByUserId: "user-admin"
  });
  await writeFile(dbPath, `${JSON.stringify(state, null, 2)}\n`);
  const before = await db();
  const assigned = await match(admin);
  const assignedCandidate = assigned.json.groups.flatMap((group) => group.candidates)
    .find((candidate) => candidate.provider.userId === unassignedCandidate.provider.userId);
  assert.deepEqual(assignedCandidate.caseAssignment, { status: "assigned", label: "Already assigned to this client" });
  assert.equal(assignedCandidate.group, originalGroup);
  assert.deepEqual(await db(), before);
});

test("Staffing reuses the authoritative assignment mutation and changes no scheduling records", async () => {
  await resetDb();
  const admin = await login();
  const before = await db();
  const result = await match(admin);
  const rbt = result.json.groups.flatMap((group) => group.candidates)
    .find((candidate) => candidate.provider.role === "rbt").provider;

  const assigned = await request("/api/clients/client-1/assignments", {
    method: "POST",
    cookie: admin,
    body: { userId: rbt.userId }
  });
  assert.equal(assigned.response.status, 201);
  assert.equal(assigned.json.assignment.clientId, "client-1");
  assert.equal(assigned.json.assignment.userId, rbt.userId);

  const persisted = await db();
  assert.equal(persisted.clientUserAssignments.length, 1);
  assert.equal(persisted.auditLog.filter((entry) => entry.action === "client-provider-assigned").length, 1);
  assert.deepEqual(persisted.appointments, before.appointments);
  assert.deepEqual(persisted.recurringAppointmentSeries, before.recurringAppointmentSeries);
  assert.deepEqual(persisted.providerAvailabilityProfiles, before.providerAvailabilityProfiles);
  assert.deepEqual(persisted.providerZoneProfiles, before.providerZoneProfiles);

  const duplicate = await request("/api/clients/client-1/assignments", {
    method: "POST",
    cookie: admin,
    body: { userId: rbt.userId }
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal((await db()).clientUserAssignments.length, 1);
});

test("existing assignment authorization and validation remain authoritative for Staffing", async () => {
  await resetDb();
  const admin = await login();
  const state = await db();
  const rbt = state.users.find((user) => user.role === "rbt");
  const bcba = state.users.find((user) => user.role === "bcba");
  rbt.agency = "Provider Legacy Agency";
  state.clients[0].agency = "Client Legacy Agency";
  await writeFile(dbPath, `${JSON.stringify(state, null, 2)}\n`);

  const bcbaCookie = await login("bcba", "bcba123");
  const byBcba = await request("/api/clients/client-1/assignments", {
    method: "POST",
    cookie: bcbaCookie,
    body: { userId: rbt.id }
  });
  assert.equal(byBcba.response.status, 201);

  await resetDb();
  const resetAdmin = await login();
  const roles = [
    [await login("rbt", "rbt123"), 403],
    [await login("readonly", "readonly123"), 403],
    ["", 401]
  ];
  for (const [cookie, status] of roles) {
    const denied = await request("/api/clients/client-1/assignments", {
      method: "POST",
      cookie,
      body: { userId: "user-rbt" }
    });
    assert.equal(denied.response.status, status);
  }

  const invalidClient = await request("/api/clients/missing/assignments", {
    method: "POST",
    cookie: resetAdmin,
    body: { userId: "user-rbt" }
  });
  assert.equal(invalidClient.response.status, 403);
  const invalidProvider = await request("/api/clients/client-1/assignments", {
    method: "POST",
    cookie: resetAdmin,
    body: { userId: "missing" }
  });
  assert.equal(invalidProvider.response.status, 400);

  const inactiveState = await db();
  inactiveState.users.find((user) => user.id === "user-rbt").active = false;
  await writeFile(dbPath, `${JSON.stringify(inactiveState, null, 2)}\n`);
  const inactive = await request("/api/clients/client-1/assignments", {
    method: "POST",
    cookie: resetAdmin,
    body: { userId: "user-rbt" }
  });
  assert.equal(inactive.response.status, 400);

  const bcbaMatch = await match(resetAdmin, criteria({ cptCode: "97155" }));
  const candidates = bcbaMatch.json.groups.flatMap((group) => group.candidates);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].provider.userId, bcba.id);
  assert.equal(candidates[0].caseAssignment, null);
});

test("Schedule from Staffing reuses single appointment creation with stable match identities", async () => {
  await resetDb();
  const admin = await login();
  const matched = await match(admin);
  assert.equal(matched.response.status, 200);
  assert.equal(matched.json.permissions.canCreateAppointments, true);
  const candidates = matched.json.groups.flatMap((group) => group.candidates);
  const bcba = candidates.find((candidate) => candidate.provider.role === "bcba");
  const rbt = candidates.find((candidate) => candidate.provider.role === "rbt");
  assert.ok(bcba);
  assert.ok(rbt);
  assert.equal(bcba.caseAssignment, null);

  const created = await request("/api/appointments", {
    method: "POST",
    cookie: admin,
    body: appointmentFromMatch(matched.json, bcba)
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.json.clientId, "client-1");
  assert.equal(created.json.serviceCode, "97153");
  assert.equal(created.json.providerAssignments[0].userId, bcba.provider.userId);
  assert.equal(created.json.locationId, "location-1");
  assert.equal(created.json.locationSnapshot.label, "Home");
  assert.equal(created.json.timeZone, "America/New_York");

  const persisted = await db();
  assert.equal(persisted.appointments.length, 1);
  assert.equal(persisted.recurringAppointmentSeries.length, 0);
  assert.equal(persisted.clientUserAssignments.length, 0);
  assert.equal(persisted.auditLog.filter((entry) => entry.action === "appointment-created").length, 1);

  const staleConflict = await request("/api/appointments", {
    method: "POST",
    cookie: admin,
    body: appointmentFromMatch(matched.json, bcba)
  });
  assert.equal(staleConflict.response.status, 400);
  assert.match(staleConflict.json.errors.join(" "), /already scheduled/i);
  assert.equal((await db()).appointments.length, 1);
});

test("an assigned RBT remains separately eligible for one Staffing appointment", async () => {
  await resetDb();
  const admin = await login();
  const initial = await match(admin);
  const rbt = initial.json.groups.flatMap((group) => group.candidates)
    .find((candidate) => candidate.provider.role === "rbt");
  const assigned = await request("/api/clients/client-1/assignments", {
    method: "POST",
    cookie: admin,
    body: { userId: rbt.provider.userId }
  });
  assert.equal(assigned.response.status, 201);

  const refreshed = await match(admin);
  const assignedRbt = refreshed.json.groups.flatMap((group) => group.candidates)
    .find((candidate) => candidate.provider.userId === rbt.provider.userId);
  assert.equal(assignedRbt.caseAssignment.status, "assigned");
  assert.equal(assignedRbt.availability.status, "not_configured");
  assert.equal(assignedRbt.schedule.status, "none");

  const created = await request("/api/appointments", {
    method: "POST",
    cookie: admin,
    body: appointmentFromMatch(refreshed.json, assignedRbt)
  });
  assert.equal(created.response.status, 201);
  const persisted = await db();
  assert.equal(persisted.appointments.length, 1);
  assert.equal(persisted.clientUserAssignments.length, 1);
  assert.equal(persisted.recurringAppointmentSeries.length, 0);
});

test("authoritative availability changes after matching prevent stale Staffing creation", async () => {
  await resetDb();
  const admin = await login();
  const matched = await match(admin);
  const bcba = matched.json.groups.flatMap((group) => group.candidates)
    .find((candidate) => candidate.provider.role === "bcba");
  const state = await db();
  state.providerAvailabilityProfiles.push({
    id: "availability-bcba",
    providerUserId: bcba.provider.userId,
    active: true,
    effectiveDate: "2026-09-01",
    timezone: "America/New_York",
    weeklyAvailability: {
      monday: [{ start: "10:00", end: "17:00" }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: []
    },
    version: 1
  });
  await writeFile(dbPath, `${JSON.stringify(state, null, 2)}\n`);

  const staleAvailability = await request("/api/appointments", {
    method: "POST",
    cookie: admin,
    body: appointmentFromMatch(matched.json, bcba)
  });
  assert.equal(staleAvailability.response.status, 400);
  assert.match(staleAvailability.json.errors.join(" "), /outside .*configured availability/i);
  assert.equal((await db()).appointments.length, 0);
});
