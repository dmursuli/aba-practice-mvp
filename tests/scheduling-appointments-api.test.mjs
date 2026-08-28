import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = process.env.DB_PATH || join(await mkdtemp(join(tmpdir(), "aba-appointments-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";

const dbPath = process.env.DB_PATH;
const clinicalClient = {
  id: "client-1",
  name: "Clinical Sentinel",
  agency: "Triumph ABA",
  status: "active",
  defaultSetting: "home",
  profile: { documents: [], authorization: { number: "AUTH-1", services: {} } },
  domains: ["Functional Communication"],
  programs: [{
    id: "program-1",
    name: "Manding",
    domain: "Functional Communication",
    status: "active",
    targets: [{ id: "target-1", name: "Request help", status: "active" }]
  }],
  behaviors: [],
  workflowBoard: [],
  planChangeLog: [{
    id: "change-1",
    clientId: "client-1",
    sessionId: "session-1",
    sessionDate: "2026-08-01",
    serviceCode: "97155",
    context: "treatment-planning"
  }],
  note97151: "Assessment note sentinel",
  note97155: "Protocol note sentinel",
  note97151History: [{ id: "note-97151", note: "Assessment history sentinel", status: "finalized" }],
  note97155History: [{ id: "note-97155", note: "Protocol history sentinel", status: "finalized" }]
};
const clinicalSession = {
  id: "session-1",
  clientId: "client-1",
  agency: "Triumph ABA",
  date: "2026-08-01",
  serviceType: "97153",
  startTime: "09:00",
  endTime: "10:00",
  therapist: "Legacy Therapist",
  soapNote: "Finalized SOAP sentinel",
  noteStatus: "finalized",
  finalized: true,
  finalizedSnapshot: { soapNote: "Finalized SOAP sentinel" },
  amendments: [{ id: "amendment-1", reason: "Sentinel" }],
  programs: [],
  behaviors: []
};
const baseDb = {
  clients: [clinicalClient],
  sessions: [clinicalSession],
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
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  resetRuntimeState();
  await new Promise((resolve) => server.close(resolve));
});

async function resetDb(nextDb = baseDb) {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify(structuredClone(nextDb), null, 2)}\n`, "utf8");
}

async function readDbFile() {
  return JSON.parse(await readFile(dbPath, "utf8"));
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
  return {
    response,
    json: text ? JSON.parse(text) : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || ""
  };
}

async function loginAs(username = "admin", password = "admin123") {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { username, password }
  });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

function appointmentPayload(overrides = {}) {
  return {
    clientId: "client-1",
    serviceCode: "97153",
    providerAssignments: [{ userId: "user-rbt", assignmentRole: "primary" }],
    scheduledStartAt: "2026-08-03T09:00:00-04:00",
    scheduledEndAt: "2026-08-03T10:00:00-04:00",
    timeZone: "America/New_York",
    settingType: "home",
    locationId: "",
    locationSnapshot: {
      label: "Home",
      addressLine1: "",
      addressLine2: "",
      city: "Miami",
      state: "FL",
      postalCode: "33186"
    },
    authorizationRef: {
      number: "AUTH-1",
      startDate: "2026-08-01",
      endDate: "2026-08-31"
    },
    notes: "Operational scheduling note",
    ...overrides
  };
}

async function createAppointment(cookie, overrides = {}) {
  return request("/api/appointments", {
    method: "POST",
    cookie,
    body: appointmentPayload(overrides)
  });
}

async function createServiceLocation(cookie, clientId = "client-1", overrides = {}) {
  return request(`/api/clients/${clientId}/service-locations`, {
    method: "POST",
    cookie,
    body: {
      name: "Home",
      settingType: "home",
      zone: "West Kendall",
      address: {
        line1: "123 Saved Way",
        line2: "Unit 4",
        city: "Miami",
        state: "FL",
        postalCode: "33186"
      },
      operationalNote: "Use side gate.",
      isPrimary: true,
      ...overrides
    }
  });
}

test("legacy state initializes appointments and recurring series without a migration", async () => {
  await resetDb();
  const cookie = await loginAs();
  const result = await request("/api/appointments?startDate=2026-08-01&endDate=2026-08-31", { cookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.appointments, []);
  const persisted = await readDbFile();
  assert.deepEqual(persisted.appointments, []);
  assert.deepEqual(persisted.recurringAppointmentSeries, []);
});

test("legacy recurrence placeholders load without requiring new occurrence identity fields", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  assert.equal(created.response.status, 201);
  const legacyDb = await readDbFile();
  const legacyAppointment = legacyDb.appointments[0];
  for (const field of [
    "recurrenceRevisionId", "recurrenceRowId", "recurrenceOccurrenceId",
    "originalOccurrenceLocalDate", "generationKind", "recurrenceException", "lastSeriesOperationId"
  ]) delete legacyAppointment[field];
  legacyAppointment.recurrenceSeriesId = "legacy-series";
  legacyAppointment.originalOccurrenceStartAt = legacyAppointment.scheduledStartAt;
  await writeFile(dbPath, `${JSON.stringify(legacyDb, null, 2)}\n`, "utf8");

  const range = await request("/api/appointments?startDate=2026-08-01&endDate=2026-08-31", { cookie });
  assert.equal(range.response.status, 200);
  assert.equal(range.json.appointments[0].recurrenceSeriesId, "legacy-series");
  assert.equal(range.json.appointments[0].originalOccurrenceStartAt, legacyAppointment.scheduledStartAt);
  assert.equal(range.json.appointments[0].recurrenceRevisionId, "");
  assert.equal(range.json.appointments[0].recurrenceException, null);
  const persisted = await readDbFile();
  assert.equal("recurrenceRevisionId" in persisted.appointments[0], false);
  assert.equal("recurrenceException" in persisted.appointments[0], false);
});

test("appointment endpoints require authentication and Scheduling roles", async () => {
  await resetDb();
  const anonymous = await request("/api/appointments?startDate=2026-08-01&endDate=2026-08-31");
  assert.equal(anonymous.response.status, 401);

  const rbtCookie = await loginAs("rbt", "rbt123");
  const rbtRead = await request("/api/appointments?startDate=2026-08-01&endDate=2026-08-31", { cookie: rbtCookie });
  assert.equal(rbtRead.response.status, 403);
  const rbtCreate = await createAppointment(rbtCookie);
  assert.equal(rbtCreate.response.status, 403);

  const readOnlyCookie = await loginAs("readonly", "readonly123");
  const readOnlyRead = await request("/api/appointments?startDate=2026-08-01&endDate=2026-08-31", { cookie: readOnlyCookie });
  assert.equal(readOnlyRead.response.status, 403);
});

test("appointment options are active, eligible, same-agency, and available to admin and BCBA", async () => {
  await resetDb({
    ...baseDb,
    clients: [
      clinicalClient,
      { ...clinicalClient, id: "archived-client", name: "Archived Client", status: "archived" },
      { ...clinicalClient, id: "other-client", name: "Other Client", agency: "One Clinical Care" }
    ]
  });
  const adminCookie = await loginAs();
  const deactivate = await request("/api/users/user-rbt", {
    method: "PUT",
    cookie: adminCookie,
    body: {
      name: "RBT User",
      email: "rbt@local.test",
      role: "rbt",
      agency: "Triumph ABA",
      active: false
    }
  });
  assert.equal(deactivate.response.status, 200);
  const otherProvider = await request("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      username: "options-other-rbt",
      email: "options-other-rbt@example.test",
      name: "Other Agency RBT",
      password: "other123",
      role: "rbt",
      agency: "One Clinical Care"
    }
  });
  assert.equal(otherProvider.response.status, 201);

  const adminOptions = await request("/api/appointment-options", { cookie: adminCookie });
  assert.equal(adminOptions.response.status, 200);
  assert.deepEqual(adminOptions.json.clients.map((client) => client.id), ["client-1"]);
  assert.deepEqual(adminOptions.json.providers.map((provider) => provider.id), ["user-bcba"]);
  assert.ok(adminOptions.json.providers.every((provider) => ["bcba", "rbt"].includes(provider.role)));
  assert.ok(adminOptions.json.providers.every((provider) => !["email", "username", "agency"].some((key) => key in provider)));

  const bcbaCookie = await loginAs("bcba", "bcba123");
  const bcbaOptions = await request("/api/appointment-options", { cookie: bcbaCookie });
  assert.equal(bcbaOptions.response.status, 200);
  assert.deepEqual(bcbaOptions.json.clients.map((client) => client.id), ["client-1"]);

  const readOnlyCookie = await loginAs("readonly", "readonly123");
  const readOnlyOptions = await request("/api/appointment-options", { cookie: readOnlyCookie });
  assert.equal(readOnlyOptions.response.status, 403);
});

test("create validates canonical service codes, providers, timestamps, timezone, and active client", async () => {
  await resetDb();
  const cookie = await loginAs();

  const valid = await createAppointment(cookie);
  assert.equal(valid.response.status, 201);
  assert.equal(valid.json.version, 1);
  assert.equal(valid.json.status, "scheduled");
  assert.equal(valid.json.serviceCode, "97153");
  assert.equal(valid.json.sessionId, "");
  assert.equal(valid.json.cancellation, null);
  assert.ok(valid.json.id);
  assert.deepEqual(Object.keys(valid.json).sort(), [
    "agency",
    "authorizationRef",
    "cancellation",
    "clientId",
    "createdAt",
    "createdBy",
    "generationKind",
    "id",
    "lastSeriesOperationId",
    "linkedAt",
    "linkedBy",
    "locationId",
    "locationSnapshot",
    "notes",
    "originalOccurrenceLocalDate",
    "originalOccurrenceStartAt",
    "providerAssignments",
    "recurrenceException",
    "recurrenceOccurrenceId",
    "recurrenceRevisionId",
    "recurrenceRowId",
    "recurrenceSeriesId",
    "replacedByAppointmentId",
    "replacesAppointmentId",
    "scheduledEndAt",
    "scheduledStartAt",
    "serviceCode",
    "sessionId",
    "settingType",
    "status",
    "timeZone",
    "updatedAt",
    "updatedBy",
    "version"
  ].sort());

  const legacyCode = await createAppointment(cookie, { serviceCode: "parent-training" });
  assert.equal(legacyCode.response.status, 400);
  assert.match(legacyCode.json.errors.join(" "), /97151, 97153, 97155, or 97156/);

  const wrongRole = await createAppointment(cookie, {
    providerAssignments: [{ userId: "user-bcba", assignmentRole: "primary" }]
  });
  assert.equal(wrongRole.response.status, 400);
  assert.match(wrongRole.json.errors.join(" "), /role is not permitted/);

  const missingPrimary = await createAppointment(cookie, {
    providerAssignments: [{ userId: "user-rbt", assignmentRole: "secondary" }]
  });
  assert.equal(missingPrimary.response.status, 400);
  assert.match(missingPrimary.json.errors.join(" "), /Exactly one primary provider/);

  const unknownProvider = await createAppointment(cookie, {
    providerAssignments: [{ userId: "missing-user", assignmentRole: "primary" }]
  });
  assert.equal(unknownProvider.response.status, 400);
  assert.match(unknownProvider.json.errors.join(" "), /does not exist/);

  const invalidTimeZone = await createAppointment(cookie, { timeZone: "Eastern Time" });
  assert.equal(invalidTimeZone.response.status, 400);
  assert.match(invalidTimeZone.json.errors.join(" "), /valid IANA timezone/);

  const missingOffset = await createAppointment(cookie, { scheduledStartAt: "2026-08-03T09:00:00" });
  assert.equal(missingOffset.response.status, 400);
  assert.match(missingOffset.json.errors.join(" "), /explicit offset/);

  const backwards = await createAppointment(cookie, {
    scheduledStartAt: "2026-08-03T10:00:00-04:00",
    scheduledEndAt: "2026-08-03T09:00:00-04:00"
  });
  assert.equal(backwards.response.status, 400);
  assert.match(backwards.json.errors.join(" "), /must be after/);

  const crossMidnight = await createAppointment(cookie, {
    scheduledStartAt: "2026-08-03T23:00:00-04:00",
    scheduledEndAt: "2026-08-04T00:30:00-04:00"
  });
  assert.equal(crossMidnight.response.status, 400);
  assert.match(crossMidnight.json.errors.join(" "), /Cross-midnight/);

  await resetDb({ ...baseDb, clients: [{ ...clinicalClient, status: "archived" }] });
  const archivedCookie = await loginAs();
  const archivedClient = await createAppointment(archivedCookie);
  assert.equal(archivedClient.response.status, 400);
  assert.match(archivedClient.json.errors.join(" "), /Client must be active/);
});

test("provider must be active and in the client agency", async () => {
  await resetDb();
  const cookie = await loginAs();
  const deactivate = await request("/api/users/user-rbt", {
    method: "PUT",
    cookie,
    body: {
      name: "RBT User",
      email: "rbt@local.test",
      role: "rbt",
      agency: "Triumph ABA",
      active: false
    }
  });
  assert.equal(deactivate.response.status, 200);
  const inactive = await createAppointment(cookie);
  assert.equal(inactive.response.status, 400);
  assert.match(inactive.json.errors.join(" "), /must be active/);

  await resetDb();
  const nextCookie = await loginAs();
  const otherAgencyProvider = await request("/api/users", {
    method: "POST",
    cookie: nextCookie,
    body: {
      username: "other-rbt",
      email: "other-rbt@example.test",
      name: "Other Agency RBT",
      password: "other123",
      role: "rbt",
      agency: "One Clinical Care"
    }
  });
  assert.equal(otherAgencyProvider.response.status, 201);
  const mismatch = await createAppointment(nextCookie, {
    providerAssignments: [{ userId: otherAgencyProvider.json.id, assignmentRole: "primary" }]
  });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.json.errors.join(" "), /must belong to the appointment agency/);
});

test("date-range and ID reads are lightweight and agency scoped", async () => {
  await resetDb();
  const adminCookie = await loginAs();
  const triumph = await createAppointment(adminCookie);
  assert.equal(triumph.response.status, 201);
  const outsideRange = await createAppointment(adminCookie, {
    scheduledStartAt: "2026-09-03T09:00:00-04:00",
    scheduledEndAt: "2026-09-03T10:00:00-04:00"
  });
  assert.equal(outsideRange.response.status, 201);

  const otherProvider = await request("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      username: "one-rbt",
      email: "one-rbt@example.test",
      name: "One Clinical RBT",
      password: "one123",
      role: "rbt",
      agency: "One Clinical Care"
    }
  });
  const otherClient = await request("/api/clients", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "Other Agency Client", agency: "One Clinical Care" }
  });
  assert.equal(otherProvider.response.status, 201);
  assert.equal(otherClient.response.status, 201);
  const otherAppointment = await createAppointment(adminCookie, {
    clientId: otherClient.json.id,
    providerAssignments: [{ userId: otherProvider.json.id, assignmentRole: "primary" }]
  });
  assert.equal(otherAppointment.response.status, 201);

  const bcbaCookie = await loginAs("bcba", "bcba123");
  const range = await request("/api/appointments?startDate=2026-08-01&endDate=2026-08-31", { cookie: bcbaCookie });
  assert.equal(range.response.status, 200);
  assert.equal(range.json.appointments.length, 1);
  assert.equal(range.json.appointments[0].id, triumph.json.id);
  assert.equal("notes" in range.json.appointments[0], false);
  assert.equal("createdBy" in range.json.appointments[0], false);
  assert.equal("soapNote" in range.json.appointments[0], false);

  const byId = await request(`/api/appointments/${triumph.json.id}`, { cookie: bcbaCookie });
  assert.equal(byId.response.status, 200);
  assert.equal(byId.json.notes, "Operational scheduling note");
  const blocked = await request(`/api/appointments/${otherAppointment.json.id}`, { cookie: bcbaCookie });
  assert.equal(blocked.response.status, 403);
});

test("updates increment versions and reject stale or immutable linkage writes", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  assert.equal(created.response.status, 201);

  const concurrent = await Promise.all([
    request(`/api/appointments/${created.json.id}`, {
      method: "PUT",
      cookie,
      body: { expectedVersion: 1, status: "confirmed", notes: "Concurrent update A" }
    }),
    request(`/api/appointments/${created.json.id}`, {
      method: "PUT",
      cookie,
      body: { expectedVersion: 1, status: "confirmed", notes: "Concurrent update B" }
    })
  ]);
  assert.deepEqual(concurrent.map((result) => result.response.status).sort(), [200, 409]);
  const updated = concurrent.find((result) => result.response.status === 200);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.version, 2);
  assert.equal(updated.json.status, "confirmed");
  assert.equal(updated.json.id, created.json.id);

  const stale = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 1, notes: "Stale write" }
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.json.currentVersion, 2);

  const linkage = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 2, sessionId: "session-1" }
  });
  assert.equal(linkage.response.status, 400);
  assert.match(linkage.json.errors.join(" "), /sessionId is immutable/);

  const cancelledThroughUpdate = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 2, status: "cancelled" }
  });
  assert.equal(cancelledThroughUpdate.response.status, 400);
  assert.match(cancelledThroughUpdate.json.errors.join(" "), /cancellation endpoint/);
});

test("confirmation is role checked, version checked, audited, and changes only operational status", async () => {
  await resetDb();
  const adminCookie = await loginAs();
  const locationResult = await createServiceLocation(adminCookie);
  assert.equal(locationResult.response.status, 201);
  const location = locationResult.json.profile.serviceLocations[0];
  const created = await createAppointment(adminCookie, {
    locationId: location.id,
    settingType: "clinic",
    locationSnapshot: { label: "Spoofed location", zone: "Spoofed zone" }
  });
  assert.equal(created.response.status, 201);
  const before = await readDbFile();
  const beforeAppointment = structuredClone(before.appointments[0]);

  const rbtCookie = await loginAs("rbt", "rbt123");
  const rbtAttempt = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie: rbtCookie,
    body: { expectedVersion: 1, status: "confirmed" }
  });
  assert.equal(rbtAttempt.response.status, 403);

  const readOnlyCookie = await loginAs("readonly", "readonly123");
  const readOnlyAttempt = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie: readOnlyCookie,
    body: { expectedVersion: 1, status: "confirmed" }
  });
  assert.equal(readOnlyAttempt.response.status, 403);

  const bcbaCookie = await loginAs("bcba", "bcba123");
  const beforeConfirmation = await readDbFile();
  const { appointments: ignoredAppointments, auditLog: ignoredAuditLog, ...protectedBefore } = structuredClone(beforeConfirmation);
  const confirmed = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie: bcbaCookie,
    body: { expectedVersion: 1, status: "confirmed" }
  });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.json.id, beforeAppointment.id);
  assert.equal(confirmed.json.status, "confirmed");
  assert.equal(confirmed.json.version, 2);
  for (const field of [
    "clientId", "providerAssignments", "serviceCode", "scheduledStartAt", "scheduledEndAt",
    "timeZone", "locationId", "locationSnapshot", "settingType", "zoneId", "sessionId"
  ]) assert.deepEqual(confirmed.json[field], beforeAppointment[field], field);

  const persisted = await readDbFile();
  const confirmationAudits = persisted.auditLog.filter((entry) => (
    entry.action === "appointment-updated"
    && entry.details?.appointmentId === created.json.id
    && entry.details?.status === "confirmed"
  ));
  assert.equal(confirmationAudits.length, 1);
  assert.equal(confirmationAudits[0].userId, "user-bcba");
  assert.ok(confirmationAudits[0].timestamp);
  assert.equal(confirmationAudits[0].details.version, 2);
  const { appointments: persistedAppointments, auditLog: persistedAuditLog, ...protectedAfter } = persisted;
  assert.deepEqual(protectedAfter, protectedBefore);

  const stale = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie: adminCookie,
    body: { expectedVersion: 1, status: "confirmed" }
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.json.currentVersion, 2);
  const afterStale = await readDbFile();
  assert.equal(afterStale.appointments[0].version, 2);
  assert.equal(afterStale.auditLog.filter((entry) => (
    entry.action === "appointment-updated" && entry.details?.appointmentId === created.json.id
  )).length, 1);
});

test("updates keep client identity immutable and preserve it when omitted", async () => {
  await resetDb({
    ...baseDb,
    clients: [
      clinicalClient,
      { ...clinicalClient, id: "client-2", name: "Other Clinical Sentinel" }
    ]
  });
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  const before = await readDbFile();

  const changedClient = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 1, clientId: "client-2", notes: "Must not move clients" }
  });
  assert.equal(changedClient.response.status, 400);
  assert.match(changedClient.json.errors.join(" "), /clientId is immutable/);
  let persisted = await readDbFile();
  assert.equal(persisted.appointments[0].clientId, "client-1");
  assert.equal(persisted.appointments[0].version, 1);
  assert.deepEqual(persisted.clients, before.clients);
  assert.deepEqual(persisted.sessions, before.sessions);

  const omittedClient = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 1, notes: "Client remains unchanged" }
  });
  assert.equal(omittedClient.response.status, 200);
  assert.equal(omittedClient.json.clientId, "client-1");
  assert.equal(omittedClient.json.version, 2);
  persisted = await readDbFile();
  assert.equal(persisted.appointments[0].clientId, "client-1");
  assert.deepEqual(persisted.clients, before.clients);
  assert.deepEqual(persisted.sessions, before.sessions);
});

test("location changes resolve an active location from the appointment client and rebuild its snapshot", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie, {
    locationSnapshot: { label: "Legacy home", zone: "Legacy zone", addressLine1: "Old address" }
  });
  const locationResult = await createServiceLocation(cookie, "client-1", {
    name: "School",
    settingType: "school",
    zone: "Doral",
    address: { line1: "456 School Way", line2: "Room 10", city: "Miami", state: "FL", postalCode: "33101" },
    operationalNote: "Dismissal is at 2:15."
  });
  assert.equal(locationResult.response.status, 201);
  const location = locationResult.json.profile.serviceLocations[0];
  const clinicalBeforeUpdate = await readDbFile();

  const updated = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: {
      expectedVersion: 1,
      locationId: location.id,
      settingType: "clinic",
      locationSnapshot: {
        label: "Spoofed clinic",
        zone: "Miami Beach",
        addressLine1: "Wrong address",
        operationalNote: "Untrusted note"
      }
    }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.version, 2);
  assert.equal(updated.json.locationId, location.id);
  assert.equal(updated.json.settingType, "school");
  assert.deepEqual(updated.json.locationSnapshot, {
    label: "School",
    zone: "Doral",
    addressLine1: "456 School Way",
    addressLine2: "Room 10",
    city: "Miami",
    state: "FL",
    postalCode: "33101",
    operationalNote: "Dismissal is at 2:15."
  });
  const persisted = await readDbFile();
  assert.deepEqual(persisted.clients, clinicalBeforeUpdate.clients);
  assert.deepEqual(persisted.sessions, clinicalBeforeUpdate.sessions);
  assert.deepEqual(persisted.clients[0].planChangeLog, clinicalBeforeUpdate.clients[0].planChangeLog);
  assert.deepEqual(persisted.clients[0].note97151History, clinicalBeforeUpdate.clients[0].note97151History);
  assert.deepEqual(persisted.clients[0].note97155History, clinicalBeforeUpdate.clients[0].note97155History);
});

test("location updates reject inactive and other-client IDs without mutating the appointment", async () => {
  await resetDb({
    ...baseDb,
    clients: [
      clinicalClient,
      { ...clinicalClient, id: "client-2", name: "Other Clinical Sentinel" }
    ]
  });
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  const inactiveResult = await createServiceLocation(cookie, "client-1", { name: "Old Clinic", settingType: "clinic", zone: "Kendall" });
  const inactiveLocation = inactiveResult.json.profile.serviceLocations[0];
  const deactivated = await request(`/api/clients/client-1/service-locations/${inactiveLocation.id}/deactivate`, {
    method: "POST",
    cookie
  });
  assert.equal(deactivated.response.status, 200);
  const otherResult = await createServiceLocation(cookie, "client-2", { name: "Other Home" });
  const otherLocation = otherResult.json.profile.serviceLocations[0];
  const before = await readDbFile();

  for (const locationId of [inactiveLocation.id, otherLocation.id, "missing-location-id"]) {
    const rejected = await request(`/api/appointments/${created.json.id}`, {
      method: "PUT",
      cookie,
      body: { expectedVersion: 1, locationId, settingType: "home", locationSnapshot: { label: "Spoofed" } }
    });
    assert.equal(rejected.response.status, 400);
    assert.match(rejected.json.errors.join(" "), /active service location saved in the Client Profile/);
  }
  const persisted = await readDbFile();
  assert.deepEqual(persisted.appointments, before.appointments);
  assert.deepEqual(persisted.clients, before.clients);
  assert.deepEqual(persisted.sessions, before.sessions);
});

test("legacy location snapshots stay unchanged until a new structured location is selected", async () => {
  await resetDb();
  const cookie = await loginAs();
  const legacySnapshot = {
    label: "Legacy caregiver home",
    zone: "Legacy manual zone",
    addressLine1: "789 Old Way",
    addressLine2: "",
    city: "Miami",
    state: "FL",
    postalCode: "33101",
    operationalNote: "Legacy operational note"
  };
  const created = await createAppointment(cookie, { settingType: "home", locationId: "", locationSnapshot: legacySnapshot });
  const missingLocation = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 1, locationId: "missing-location-id", settingType: "clinic" }
  });
  assert.equal(missingLocation.response.status, 400);
  assert.match(missingLocation.json.errors.join(" "), /active service location saved in the Client Profile/);
  const locationResult = await createServiceLocation(cookie, "client-1", { name: "Current Home" });
  const location = locationResult.json.profile.serviceLocations[0];

  const preserved = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: {
      expectedVersion: 1,
      notes: "Operational note updated",
      settingType: "clinic",
      locationSnapshot: { label: "Untrusted replacement", zone: "Doral" }
    }
  });
  assert.equal(preserved.response.status, 200);
  assert.equal(preserved.json.version, 2);
  assert.equal(preserved.json.settingType, "home");
  assert.deepEqual(preserved.json.locationSnapshot, legacySnapshot);

  const replaced = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 2, locationId: location.id, locationSnapshot: legacySnapshot }
  });
  assert.equal(replaced.response.status, 200);
  assert.equal(replaced.json.version, 3);
  assert.equal(replaced.json.locationId, location.id);
  assert.equal(replaced.json.locationSnapshot.label, "Current Home");
  assert.equal(replaced.json.locationSnapshot.zone, "West Kendall");
  assert.notDeepEqual(replaced.json.locationSnapshot, legacySnapshot);
});

test("all appointment linkage and history fields remain immutable on update", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  const before = await readDbFile();
  const rejected = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: {
      expectedVersion: 1,
      id: "different-id",
      agency: "One Clinical Care",
      sessionId: "session-1",
      linkedAt: "2026-08-19T12:00:00Z",
      linkedBy: "user-admin",
      recurrenceSeriesId: "series-1",
      recurrenceRevisionId: "revision-1",
      recurrenceRowId: "tuesday",
      recurrenceOccurrenceId: "occurrence-1",
      originalOccurrenceLocalDate: "2026-08-03",
      originalOccurrenceStartAt: "2026-08-03T09:00:00-04:00",
      generationKind: "generated",
      recurrenceException: { type: "modified" },
      lastSeriesOperationId: "operation-1",
      replacesAppointmentId: "old-appointment",
      replacedByAppointmentId: "new-appointment",
      cancellation: { reason: "other" },
      createdAt: "2020-01-01T00:00:00Z",
      createdBy: "different-user"
    }
  });
  assert.equal(rejected.response.status, 400);
  const errors = rejected.json.errors.join(" ");
  for (const field of [
    "Appointment ID", "agency", "sessionId", "linkedAt", "linkedBy", "recurrenceSeriesId",
    "recurrenceRevisionId", "recurrenceRowId", "recurrenceOccurrenceId", "originalOccurrenceLocalDate",
    "originalOccurrenceStartAt", "generationKind", "recurrenceException", "lastSeriesOperationId",
    "replacesAppointmentId", "replacedByAppointmentId", "cancellation", "createdAt", "createdBy"
  ]) assert.match(errors, new RegExp(field, "i"));
  const persisted = await readDbFile();
  assert.deepEqual(persisted.appointments, before.appointments);
  assert.deepEqual(persisted.clients, before.clients);
  assert.deepEqual(persisted.sessions, before.sessions);
});

test("cancellation requires a supported category and a compatible reason", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  assert.equal(created.response.status, 201);

  const invalidPayloads = [
    { expectedVersion: 1, reason: "client_cancelled" },
    { expectedVersion: 1, category: "unknown", reason: "other" },
    { expectedVersion: 1, category: "client", reason: "provider_pto" },
    { expectedVersion: 1, category: "provider", reason: "authorization_issue" },
    { expectedVersion: 1, category: "agency", reason: "family_emergency" },
    { expectedVersion: 1, category: "client", reason: "unsupported_reason" }
  ];
  for (const body of invalidPayloads) {
    const rejected = await request(`/api/appointments/${created.json.id}/cancel`, {
      method: "POST",
      cookie,
      body
    });
    assert.equal(rejected.response.status, 400);
  }

  const persisted = await readDbFile();
  assert.equal(persisted.appointments[0].status, "scheduled");
  assert.equal(persisted.appointments[0].version, 1);
  assert.equal(persisted.appointments[0].cancellation, null);
});

test("cancellation accepts every approved category reason and keeps no_show as cancelled", async () => {
  await resetDb();
  const cookie = await loginAs();
  const taxonomy = {
    client: ["client_cancelled", "illness", "vacation", "family_emergency", "no_show", "other"],
    provider: ["provider_cancelled", "provider_illness", "provider_pto", "provider_emergency", "other"],
    agency: ["agency_cancelled", "authorization_issue", "weather", "staffing_issue", "scheduling_error", "other"]
  };

  for (const [category, reasons] of Object.entries(taxonomy)) {
    for (const reason of reasons) {
      const created = await createAppointment(cookie);
      assert.equal(created.response.status, 201);
      const cancelled = await request(`/api/appointments/${created.json.id}/cancel`, {
        method: "POST",
        cookie,
        body: { expectedVersion: 1, category, reason }
      });
      assert.equal(cancelled.response.status, 200, `${category}/${reason}`);
      assert.equal(cancelled.json.status, "cancelled", `${category}/${reason}`);
      assert.equal(cancelled.json.version, 2, `${category}/${reason}`);
      assert.equal(cancelled.json.cancellation.category, category);
      assert.equal(cancelled.json.cancellation.reason, reason);
      assert.equal(cancelled.json.cancellation.note, "");
    }
  }
});

test("cancellation note is optional and limited to the existing 360-character short-note convention", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  const tooLong = await request(`/api/appointments/${created.json.id}/cancel`, {
    method: "POST",
    cookie,
    body: { expectedVersion: 1, category: "client", reason: "other", note: "x".repeat(361) }
  });
  assert.equal(tooLong.response.status, 400);
  assert.match(tooLong.json.errors.join(" "), /360 characters or fewer/);

  const accepted = await request(`/api/appointments/${created.json.id}/cancel`, {
    method: "POST",
    cookie,
    body: { expectedVersion: 1, category: "client", reason: "other", note: "x".repeat(360) }
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.json.cancellation.note.length, 360);
});

test("legacy cancellation remains unchanged and safely resolves an inactive historical actor", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  const db = await readDbFile();
  const appointment = db.appointments.find((item) => item.id === created.json.id);
  appointment.status = "cancelled";
  appointment.cancellation = {
    reason: "client_cancelled",
    note: "Legacy operational note",
    cancelledAt: "2026-08-04T13:00:00.000Z",
    cancelledBy: "inactive-historical-bcba"
  };
  db.users.push({
    id: "inactive-historical-bcba",
    name: "Former BCBA",
    role: "bcba",
    agency: "Triumph ABA",
    active: false,
    passwordHash: "sensitive-sentinel"
  });
  db.users.push({
    id: "other-agency-historical-bcba",
    name: "Other Agency BCBA",
    role: "bcba",
    agency: "One Clinical Care",
    active: false
  });
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  const beforeRead = await readDbFile();

  const details = await request(`/api/appointments/${created.json.id}`, { cookie });
  assert.equal(details.response.status, 200);
  assert.equal("category" in details.json.cancellation, false);
  assert.equal(details.json.cancellation.cancelledBy, "inactive-historical-bcba");
  assert.deepEqual(details.json.cancellationActor, { name: "Former BCBA" });
  assert.equal(JSON.stringify(details.json.cancellationActor).includes("sensitive-sentinel"), false);
  assert.deepEqual(await readDbFile(), beforeRead);

  const crossAgencyDb = await readDbFile();
  crossAgencyDb.appointments[0].cancellation.cancelledBy = "other-agency-historical-bcba";
  await writeFile(dbPath, `${JSON.stringify(crossAgencyDb, null, 2)}\n`, "utf8");
  const crossAgencyDetails = await request(`/api/appointments/${created.json.id}`, { cookie });
  assert.equal(crossAgencyDetails.response.status, 200);
  assert.equal(crossAgencyDetails.json.cancellationActor, null);
});

test("cancellation persists history and all appointment mutations are audited without changing clinical records", async () => {
  await resetDb();
  const cookie = await loginAs();
  const initialized = await readDbFile();
  const { appointments: ignoredAppointments, auditLog: ignoredAuditLog, ...protectedBefore } = structuredClone(initialized);
  const created = await createAppointment(cookie);
  const updated = await request(`/api/appointments/${created.json.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: 1, status: "confirmed" }
  });
  assert.equal(updated.response.status, 200);
  const cancelled = await request(`/api/appointments/${created.json.id}/cancel`, {
    method: "POST",
    cookie,
    body: { expectedVersion: 2, category: "client", reason: "client_cancelled", note: "Caregiver called" }
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.json.status, "cancelled");
  assert.equal(cancelled.json.version, 3);
  assert.equal(cancelled.json.cancellation.category, "client");
  assert.equal(cancelled.json.cancellation.reason, "client_cancelled");
  assert.equal(cancelled.json.cancellation.note, "Caregiver called");
  assert.equal(cancelled.json.cancellation.cancelledBy, "user-admin");
  assert.ok(cancelled.json.cancellation.cancelledAt);

  const staleCancel = await request(`/api/appointments/${created.json.id}/cancel`, {
    method: "POST",
    cookie,
    body: { expectedVersion: 2, category: "client", reason: "other" }
  });
  assert.equal(staleCancel.response.status, 409);

  const persisted = await readDbFile();
  assert.equal(persisted.appointments.length, 1);
  assert.equal(persisted.appointments[0].status, "cancelled");
  const actions = persisted.auditLog.map((entry) => entry.action);
  assert.ok(actions.includes("appointment-created"));
  assert.ok(actions.includes("appointment-updated"));
  assert.ok(actions.includes("appointment-cancelled"));
  const appointmentAudits = persisted.auditLog.filter((entry) => entry.action.startsWith("appointment-"));
  assert.ok(appointmentAudits.every((entry) => !JSON.stringify(entry.details).includes("Caregiver called")));
  const cancellationAudit = appointmentAudits.find((entry) => entry.action === "appointment-cancelled");
  assert.equal(cancellationAudit.details.appointmentId, created.json.id);
  assert.equal(cancellationAudit.details.cancellationCategory, "client");
  assert.equal(cancellationAudit.details.cancellationReason, "client_cancelled");
  assert.equal(cancellationAudit.details.cancellationActorId, "user-admin");
  assert.equal(cancellationAudit.details.cancellationTimestamp, cancelled.json.cancellation.cancelledAt);
  assert.equal(cancellationAudit.userId, "user-admin");
  assert.ok(cancellationAudit.timestamp);
  const { appointments: persistedAppointments, auditLog: persistedAuditLog, ...protectedAfter } = persisted;
  assert.deepEqual(protectedAfter, protectedBefore);
});

test("backup and restore preserve scheduling collections and default legacy backups safely", async () => {
  const series = { id: "series-1", agency: "Triumph ABA", clientId: "client-1", version: 1 };
  await resetDb({ ...baseDb, recurringAppointmentSeries: [series] });
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  assert.equal(created.response.status, 201);

  const backup = await request("/api/backup", { cookie });
  assert.equal(backup.response.status, 200);
  assert.equal(backup.json.data.appointments.length, 1);
  assert.equal(backup.json.data.appointments[0].id, created.json.id);
  assert.deepEqual(backup.json.data.recurringAppointmentSeries, [series]);

  const restore = await request("/api/backup/restore", {
    method: "POST",
    cookie,
    body: backup.json
  });
  assert.equal(restore.response.status, 200);
  let persisted = await readDbFile();
  assert.equal(persisted.appointments.length, 1);
  assert.deepEqual(persisted.recurringAppointmentSeries, [series]);

  const legacySeriesBackup = structuredClone(backup.json);
  delete legacySeriesBackup.data.recurringAppointmentSeries;
  const legacySeriesRestore = await request("/api/backup/restore", {
    method: "POST",
    cookie,
    body: legacySeriesBackup
  });
  assert.equal(legacySeriesRestore.response.status, 200);
  persisted = await readDbFile();
  assert.equal(persisted.appointments.length, 1);
  assert.deepEqual(persisted.recurringAppointmentSeries, []);

  const legacyBackup = structuredClone(backup.json);
  delete legacyBackup.data.appointments;
  delete legacyBackup.data.recurringAppointmentSeries;
  const legacyRestore = await request("/api/backup/restore", {
    method: "POST",
    cookie,
    body: legacyBackup
  });
  assert.equal(legacyRestore.response.status, 200);
  persisted = await readDbFile();
  assert.deepEqual(persisted.appointments, []);
  assert.deepEqual(persisted.recurringAppointmentSeries, []);
  assert.deepEqual(persisted.clients, backup.json.data.clients);
  assert.deepEqual(persisted.sessions, backup.json.data.sessions);
});
