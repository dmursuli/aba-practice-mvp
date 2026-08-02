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

test("legacy state initializes appointments without a migration", async () => {
  await resetDb();
  const cookie = await loginAs();
  const result = await request("/api/appointments?startDate=2026-08-01&endDate=2026-08-31", { cookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.appointments, []);
  const persisted = await readDbFile();
  assert.deepEqual(persisted.appointments, []);
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
    "id",
    "linkedAt",
    "linkedBy",
    "locationId",
    "locationSnapshot",
    "notes",
    "originalOccurrenceStartAt",
    "providerAssignments",
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

test("cancellation persists history and all appointment mutations are audited without changing clinical records", async () => {
  await resetDb();
  const cookie = await loginAs();
  const initialized = await readDbFile();
  const clinicalBefore = structuredClone({ clients: initialized.clients, sessions: initialized.sessions });
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
    body: { expectedVersion: 2, reason: "client_cancelled", note: "Caregiver called" }
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.json.status, "cancelled");
  assert.equal(cancelled.json.version, 3);
  assert.equal(cancelled.json.cancellation.reason, "client_cancelled");
  assert.equal(cancelled.json.cancellation.note, "Caregiver called");
  assert.equal(cancelled.json.cancellation.cancelledBy, "user-admin");
  assert.ok(cancelled.json.cancellation.cancelledAt);

  const staleCancel = await request(`/api/appointments/${created.json.id}/cancel`, {
    method: "POST",
    cookie,
    body: { expectedVersion: 2, reason: "other" }
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
  assert.deepEqual(persisted.clients, clinicalBefore.clients);
  assert.deepEqual(persisted.sessions, clinicalBefore.sessions);
});

test("backup and restore preserve appointments and default legacy backups to an empty collection", async () => {
  await resetDb();
  const cookie = await loginAs();
  const created = await createAppointment(cookie);
  assert.equal(created.response.status, 201);

  const backup = await request("/api/backup", { cookie });
  assert.equal(backup.response.status, 200);
  assert.equal(backup.json.data.appointments.length, 1);
  assert.equal(backup.json.data.appointments[0].id, created.json.id);

  const restore = await request("/api/backup/restore", {
    method: "POST",
    cookie,
    body: backup.json
  });
  assert.equal(restore.response.status, 200);
  let persisted = await readDbFile();
  assert.equal(persisted.appointments.length, 1);

  const legacyBackup = structuredClone(backup.json);
  delete legacyBackup.data.appointments;
  const legacyRestore = await request("/api/backup/restore", {
    method: "POST",
    cookie,
    body: legacyBackup
  });
  assert.equal(legacyRestore.response.status, 200);
  persisted = await readDbFile();
  assert.deepEqual(persisted.appointments, []);
  assert.deepEqual(persisted.clients, backup.json.data.clients);
  assert.deepEqual(persisted.sessions, backup.json.data.sessions);
});
