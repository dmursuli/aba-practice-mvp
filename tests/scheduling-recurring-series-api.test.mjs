import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-recurring-series-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";

const dbPath = process.env.DB_PATH;
const location = {
  id: "location-home",
  name: "Home",
  settingType: "home",
  zone: "West Kendall",
  address: {
    line1: "123 Authoritative Way",
    line2: "Unit 4",
    city: "Miami",
    state: "FL",
    postalCode: "33186"
  },
  operationalNote: "Use saved entrance.",
  isPrimary: true,
  isActive: true
};
const client = {
  id: "client-1",
  name: "Recurring Client",
  agency: "Triumph ABA",
  status: "active",
  profile: {
    serviceLocations: [location],
    authorization: {
      number: "AUTH-1",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      services: {}
    }
  },
  programs: [],
  behaviors: [],
  workflowBoard: [],
  planChangeLog: [{ id: "plan-sentinel", sessionId: "session-sentinel" }],
  note97151History: [{ id: "note-sentinel", status: "finalized" }],
  note97155History: []
};
const clinicalSession = {
  id: "session-sentinel",
  clientId: "client-1",
  agency: "Triumph ABA",
  date: "2026-08-01",
  serviceType: "97153",
  soapNote: "Clinical sentinel",
  finalized: true,
  amendments: [{ id: "amendment-sentinel" }]
};
const baseDb = {
  clients: [client],
  sessions: [clinicalSession],
  appointments: [],
  recurringAppointmentSeries: [],
  historicalImportBatches: [],
  auditLog: [],
  billingRecords: [{ id: "billing-sentinel" }],
  users: []
};

await writeFile(dbPath, `${JSON.stringify(baseDb, null, 2)}\n`, "utf8");
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
  await writeFile(dbPath, `${JSON.stringify(structuredClone(next), null, 2)}\n`, "utf8");
}

async function readDb() {
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function request(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders["content-type"] = "application/json";
  if (cookie) requestHeaders.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || ""
  };
}

async function login(username = "admin", password = "admin123") {
  const result = await request("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

function seriesPayload(overrides = {}) {
  return {
    requestId: "series-request-0001",
    clientId: "client-1",
    serviceCode: "97153",
    providerUserId: "user-rbt",
    serviceLocationId: "location-home",
    timeZone: "America/New_York",
    startDate: "2026-08-03",
    endDate: "2026-08-12",
    recurrenceRows: [{ weekday: 1, startLocalTime: "09:00", endLocalTime: "10:30" }],
    operationalNote: "Scheduling logistics only.",
    ...overrides
  };
}

async function createSeries(cookie, overrides = {}, options = {}) {
  return request("/api/recurring-series", {
    method: "POST",
    cookie,
    body: seriesPayload(overrides),
    ...options
  });
}

function occurrenceEditPayload(appointment, series, overrides = {}) {
  return {
    expectedAppointmentVersion: appointment.version,
    expectedSeriesVersion: series.version,
    clientId: appointment.clientId,
    serviceCode: appointment.serviceCode,
    providerAssignments: appointment.providerAssignments,
    scheduledStartAt: appointment.scheduledStartAt,
    scheduledEndAt: appointment.scheduledEndAt,
    timeZone: appointment.timeZone,
    locationId: appointment.locationId,
    notes: appointment.notes,
    ...overrides
  };
}

function thisAndFuturePayload(appointment, series, overrides = {}) {
  return occurrenceEditPayload(appointment, series, overrides);
}

function entireSeriesFuturePayload(appointment, series, overrides = {}) {
  return {
    ...occurrenceEditPayload(appointment, series),
    recurrenceRows: [{ weekday: 1, startLocalTime: "09:00", endLocalTime: "10:30" }],
    ...overrides
  };
}

test("Admin and BCBA can create series while RBT and read-only users cannot", async () => {
  await resetDb();
  const adminCookie = await login();
  const admin = await createSeries(adminCookie);
  assert.equal(admin.response.status, 201);
  assert.equal(admin.json.appointmentCount, 2);

  await resetDb();
  const bcbaCookie = await login("bcba", "bcba123");
  const bcba = await createSeries(bcbaCookie, { requestId: "series-request-bcba" });
  assert.equal(bcba.response.status, 201);

  await resetDb();
  const rbtCookie = await login("rbt", "rbt123");
  assert.equal((await createSeries(rbtCookie)).response.status, 403);
  const readOnlyCookie = await login("readonly", "readonly123");
  assert.equal((await createSeries(readOnlyCookie)).response.status, 403);
});

test("creation uses authoritative identity, role, agency, service-code, and location validation", async () => {
  await resetDb();
  const cookie = await login();
  const initialized = await readDb();
  initialized.clients.push({ ...structuredClone(client), id: "other-client", agency: "One Clinical Care" });
  initialized.users.push({
    ...initialized.users.find((user) => user.id === "user-rbt"),
    id: "other-rbt",
    username: "other-rbt",
    agency: "One Clinical Care"
  });
  initialized.users.push({
    ...initialized.users.find((user) => user.id === "user-rbt"),
    id: "inactive-rbt",
    username: "inactive-rbt",
    active: false
  });
  await writeFile(dbPath, `${JSON.stringify(initialized, null, 2)}\n`, "utf8");

  const cases = [
    [{ requestId: "reject-cross-client", clientId: "other-client" }, /Client must belong/],
    [{ requestId: "reject-cross-provider", providerUserId: "other-rbt" }, /Provider must belong/],
    [{ requestId: "reject-inactive-rbt", providerUserId: "inactive-rbt" }, /Provider must be active/],
    [{ requestId: "reject-role-service", providerUserId: "user-bcba" }, /role is not permitted/],
    [{ requestId: "reject-service-code", serviceCode: "parent-training" }, /97151, 97153, 97155, or 97156/],
    [{ requestId: "reject-location-id", serviceLocationId: "missing" }, /active service location/]
  ];
  for (const [overrides, pattern] of cases) {
    const result = await createSeries(cookie, overrides);
    assert.equal(result.response.status, 400);
    assert.match(result.json.errors.join(" "), pattern);
  }

  const inactiveLocationDb = await readDb();
  inactiveLocationDb.clients[0].profile.serviceLocations[0].isActive = false;
  await writeFile(dbPath, `${JSON.stringify(inactiveLocationDb, null, 2)}\n`, "utf8");
  const inactiveLocation = await createSeries(cookie, { requestId: "reject-inactive-location" });
  assert.equal(inactiveLocation.response.status, 400);
  assert.match(inactiveLocation.json.errors.join(" "), /active service location/);
});

test("multiple weekdays, distinct times, inclusive boundaries, and year boundaries materialize correctly", async () => {
  await resetDb();
  const cookie = await login();
  const result = await createSeries(cookie, {
    requestId: "year-boundary-series",
    startDate: "2025-12-29",
    endDate: "2026-01-08",
    recurrenceRows: [
      { weekday: 2, startLocalTime: "14:30", endLocalTime: "18:30" },
      { weekday: 4, startLocalTime: "15:00", endLocalTime: "18:00" }
    ],
    locationSnapshot: { label: "Attacker override", addressLine1: "Wrong" },
    settingType: "clinic",
    status: "completed"
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.json.appointmentCount, 4);
  assert.deepEqual(result.json.recurrenceRows.map((row) => row.weekday), [2, 4]);
  const persisted = await readDb();
  const generated = persisted.appointments.sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
  assert.deepEqual(generated.map((item) => item.originalOccurrenceLocalDate), [
    "2025-12-30", "2026-01-01", "2026-01-06", "2026-01-08"
  ]);
  assert.match(generated[0].scheduledStartAt, /T14:30:00-05:00$/);
  assert.match(generated[1].scheduledStartAt, /T15:00:00-05:00$/);
  assert.equal(generated[0].locationSnapshot.label, "Home");
  assert.equal(generated[0].locationSnapshot.addressLine1, "123 Authoritative Way");
  assert.equal(generated[0].settingType, "home");
  assert.ok(generated.every((item) => item.status === "scheduled"));
});

test("DST preserves wall-clock time and DST validation failures persist nothing", async () => {
  await resetDb();
  const cookie = await login();
  const preserved = await createSeries(cookie, {
    requestId: "dst-preservation-series",
    startDate: "2026-03-01",
    endDate: "2026-03-15",
    recurrenceRows: [{ weekday: 0, startLocalTime: "09:00", endLocalTime: "10:00" }]
  });
  assert.equal(preserved.response.status, 201);
  const preservedDb = await readDb();
  assert.deepEqual(
    preservedDb.appointments.map((item) => item.scheduledStartAt).sort(),
    [
      "2026-03-01T09:00:00-05:00",
      "2026-03-08T09:00:00-04:00",
      "2026-03-15T09:00:00-04:00"
    ]
  );

  for (const [requestId, startDate, localTime, pattern] of [
    ["dst-nonexistent-time", "2026-03-08", "02:30", /does not exist/],
    ["dst-ambiguous-time-1", "2026-11-01", "01:30", /ambiguous/]
  ]) {
    await resetDb();
    const nextCookie = await login();
    const before = await readDb();
    const rejected = await createSeries(nextCookie, {
      requestId,
      startDate,
      endDate: startDate,
      recurrenceRows: [{ weekday: 0, startLocalTime: localTime, endLocalTime: localTime === "02:30" ? "03:30" : "02:30" }]
    });
    assert.equal(rejected.response.status, 400);
    assert.match(rejected.json.errors.join(" "), pattern);
    const afterDb = await readDb();
    assert.deepEqual(afterDb.recurringAppointmentSeries, before.recurringAppointmentSeries);
    assert.deepEqual(afterDb.appointments, before.appointments);
    assert.deepEqual(afterDb.auditLog, before.auditLog);
  }
});

test("bounded ranges, maximum duration, row validation, and request identifiers are enforced", async () => {
  await resetDb();
  const cookie = await login();
  const cases = [
    [{ requestId: "invalid-date-range", startDate: "2026-08-10", endDate: "2026-08-01" }, /on or after/],
    [{ requestId: "too-long-duration", startDate: "2026-01-01", endDate: "2027-01-01" }, /at most 12 months/],
    [{ requestId: "duplicate-weekdays", recurrenceRows: [
      { weekday: 1, startLocalTime: "09:00", endLocalTime: "10:00" },
      { weekday: 1, startLocalTime: "11:00", endLocalTime: "12:00" }
    ] }, /weekdays must be unique/],
    [{ requestId: "invalid-row-time", recurrenceRows: [
      { weekday: 8, startLocalTime: "11:00", endLocalTime: "10:00" }
    ] }, /0 through 6/],
    [{ requestId: "" }, /requestId/]
  ];
  for (const [overrides, pattern] of cases) {
    const result = await createSeries(cookie, overrides);
    assert.equal(result.response.status, 400);
    assert.match(result.json.errors.join(" "), pattern);
  }
});

test("stable occurrence identity and required request idempotency prevent duplicates", async () => {
  await resetDb();
  const cookie = await login();
  const payload = { requestId: "idempotent-series-request" };
  const first = await createSeries(cookie, payload);
  const retry = await createSeries(cookie, payload);
  assert.equal(first.response.status, 201);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.json.replayed, true);
  assert.equal(retry.json.id, first.json.id);
  assert.deepEqual(retry.json.appointmentIds, first.json.appointmentIds);

  const mismatch = await createSeries(cookie, { ...payload, endDate: "2026-08-19" });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.json.errors.join(" "), /already used/);

  const persisted = await readDb();
  assert.equal(persisted.recurringAppointmentSeries.length, 1);
  assert.equal(persisted.appointments.length, 2);
  const series = persisted.recurringAppointmentSeries[0];
  const revision = series.revisions[0];
  assert.ok(series.id);
  assert.ok(revision.id);
  assert.ok(revision.template.rows[0].rowId);
  assert.equal(new Set(persisted.appointments.map((item) => item.id)).size, 2);
  assert.equal(new Set(persisted.appointments.map((item) => item.recurrenceOccurrenceId)).size, 2);
  assert.ok(persisted.appointments.every((item) => item.recurrenceSeriesId === series.id));
  assert.ok(persisted.appointments.every((item) => item.recurrenceRevisionId === revision.id));
  assert.ok(persisted.appointments.every((item) => item.recurrenceRowId === revision.template.rows[0].rowId));
  assert.ok(persisted.appointments.every((item) => item.recurrenceOccurrenceId.startsWith("recurrence-slot-v1-")));
  assert.ok(persisted.appointments.every((item) => item.generationKind === "generated"));
  assert.ok(persisted.appointments.every((item) => item.recurrenceException === null));
});

test("creation emits one compact audit and does not mutate clinical or billing state", async () => {
  await resetDb();
  const cookie = await login();
  const before = await readDb();
  const result = await createSeries(cookie, { requestId: "audit-clinical-sentinel" });
  assert.equal(result.response.status, 201);
  const persisted = await readDb();
  assert.deepEqual(persisted.sessions, before.sessions);
  assert.deepEqual(persisted.billingRecords, before.billingRecords);
  assert.deepEqual(persisted.clients[0].planChangeLog, before.clients[0].planChangeLog);
  assert.deepEqual(persisted.clients[0].note97151History, before.clients[0].note97151History);
  const audits = persisted.auditLog.filter((entry) => entry.action === "recurring-series-created");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].details.appointmentCount, 2);
  assert.equal(audits[0].details.appointmentIds.length, 2);
  assert.equal(audits[0].details.version, 1);
  assert.equal(JSON.stringify(audits[0]).includes("123 Authoritative Way"), false);
  assert.equal(JSON.stringify(audits[0]).includes("Scheduling logistics only"), false);
});

test("practice backup and restore preserve superseded revision lifecycle history", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, { requestId: "superseded-revision-backup" });
  let persisted = await readDb();
  const active = persisted.recurringAppointmentSeries[0].revisions[0];
  const replacementId = "backup-replacement-revision";
  const supersededAt = new Date(Date.parse(active.createdAt) + 1000).toISOString();
  persisted.recurringAppointmentSeries[0].revisions = [
    {
      ...structuredClone(active),
      status: "superseded",
      supersededAt,
      supersededByRevisionId: replacementId,
      supersededByOperationId: "backup-supersession-operation"
    },
    {
      ...structuredClone(active),
      id: replacementId,
      status: "active",
      supersededAt: "",
      supersededByRevisionId: "",
      supersededByOperationId: "",
      createdAt: supersededAt
    }
  ];
  const expectedSeries = structuredClone(persisted.recurringAppointmentSeries[0]);
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  const backup = await request("/api/backup", { cookie });
  assert.equal(backup.response.status, 200);
  assert.deepEqual(backup.json.data.recurringAppointmentSeries[0], expectedSeries);

  persisted = await readDb();
  persisted.recurringAppointmentSeries = [];
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  const restored = await request("/api/backup/restore", {
    method: "POST",
    cookie,
    body: backup.json
  });
  assert.equal(restored.response.status, 200);
  persisted = await readDb();
  assert.deepEqual(persisted.recurringAppointmentSeries[0], expectedSeries);
});

test("overlaps return warnings without moving or blocking existing appointments", async () => {
  await resetDb();
  const cookie = await login();
  const standalone = await request("/api/appointments", {
    method: "POST",
    cookie,
    body: {
      clientId: "client-1",
      serviceCode: "97153",
      providerAssignments: [{ userId: "user-rbt", assignmentRole: "primary" }],
      scheduledStartAt: "2026-08-03T09:30:00-04:00",
      scheduledEndAt: "2026-08-03T10:00:00-04:00",
      timeZone: "America/New_York",
      locationId: "location-home"
    }
  });
  assert.equal(standalone.response.status, 201);
  const created = await createSeries(cookie, { requestId: "collision-warning-series" });
  assert.equal(created.response.status, 201);
  assert.deepEqual(created.json.collisionWarnings.map((warning) => warning.type).sort(), [
    "client_overlap", "provider_overlap"
  ]);
  const persisted = await readDb();
  const original = persisted.appointments.find((item) => item.id === standalone.json.id);
  assert.equal(original.scheduledStartAt, "2026-08-03T09:30:00-04:00");
  assert.equal(original.status, "scheduled");
});

test("recurring occurrence details expose a safe recurrence summary without raw identity", async () => {
  await resetDb();
  const cookie = await login();
  const created = await createSeries(cookie, { requestId: "details-recurrence-summary" });
  assert.equal(created.response.status, 201);
  const persisted = await readDb();
  const appointment = persisted.appointments[0];
  const details = await request(`/api/appointments/${appointment.id}`, { cookie });
  assert.equal(details.response.status, 200);
  assert.deepEqual(details.json.recurrence, {
    isRecurring: true,
    seriesVersion: 1,
    isException: false,
    exceptionType: "",
    canEditThisAndFuture: false,
    thisAndFutureUnavailableReason: "This occurrence begins the current series revision and cannot split it safely.",
    canEditEntireSeriesFuture: false,
    entireSeriesFutureUnavailableReason: "This recurring series has no future portion to update.",
    futureRecurrenceRows: []
  });
  for (const field of [
    "recurrenceSeriesId", "recurrenceRevisionId", "recurrenceRowId", "recurrenceOccurrenceId",
    "originalOccurrenceLocalDate", "originalOccurrenceStartAt", "generationKind",
    "recurrenceException", "lastSeriesOperationId"
  ]) assert.equal(field in details.json, false, field);
});

test("recurring occurrence edits require both versions and stale writes change nothing", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, { requestId: "required-recurrence-versions" });
  const initial = await readDb();
  const appointment = initial.appointments[0];
  const series = initial.recurringAppointmentSeries[0];

  const missingAppointmentVersion = await request(`/api/appointments/${appointment.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: appointment.version, expectedSeriesVersion: series.version, notes: "Changed" }
  });
  assert.equal(missingAppointmentVersion.response.status, 400);
  assert.match(missingAppointmentVersion.json.errors.join(" "), /expectedAppointmentVersion/);

  const missingSeriesVersion = await request(`/api/appointments/${appointment.id}`, {
    method: "PUT",
    cookie,
    body: { expectedAppointmentVersion: appointment.version, notes: "Changed" }
  });
  assert.equal(missingSeriesVersion.response.status, 400);
  assert.match(missingSeriesVersion.json.errors.join(" "), /expectedSeriesVersion/);

  for (const overrides of [
    { expectedAppointmentVersion: appointment.version + 1 },
    { expectedSeriesVersion: series.version + 1 }
  ]) {
    const before = await readDb();
    const stale = await request(`/api/appointments/${appointment.id}`, {
      method: "PUT",
      cookie,
      body: occurrenceEditPayload(appointment, series, { notes: "Stale mutation", ...overrides })
    });
    assert.equal(stale.response.status, 409);
    const after = await readDb();
    assert.deepEqual(after.appointments, before.appointments);
    assert.deepEqual(after.recurringAppointmentSeries, before.recurringAppointmentSeries);
    assert.deepEqual(after.auditLog, before.auditLog);
  }
});

test("individual edits create protected modified and moved exceptions atomically", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, { requestId: "individual-exception-edits" });
  let persisted = await readDb();
  persisted.clients[0].profile.serviceLocations.push({
    ...structuredClone(location),
    id: "location-school",
    name: "School",
    settingType: "school",
    zone: "Doral",
    isPrimary: false
  });
  persisted.users.push({
    ...structuredClone(persisted.users.find((user) => user.id === "user-rbt")),
    id: "user-rbt-2",
    username: "rbt-2",
    email: "rbt-2@local.test",
    name: "Second RBT"
  });
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  persisted = await readDb();
  const appointmentId = persisted.appointments.find((item) => (
    item.originalOccurrenceLocalDate === "2026-08-10"
  )).id;
  const originalAppointment = persisted.appointments.find((item) => item.id === appointmentId);
  const originalIdentity = Object.fromEntries([
    "recurrenceSeriesId", "recurrenceRevisionId", "recurrenceRowId", "recurrenceOccurrenceId",
    "originalOccurrenceLocalDate", "originalOccurrenceStartAt", "generationKind"
  ].map((field) => [field, originalAppointment[field]]));
  const originalTemplate = structuredClone(persisted.recurringAppointmentSeries[0].revisions);
  let priorOperationId = "";

  const edits = [
    { scheduledStartAt: "2026-08-10T10:00:00-04:00", scheduledEndAt: "2026-08-10T11:30:00-04:00", expectedType: "modified" },
    { providerAssignments: [{ userId: "user-rbt-2", assignmentRole: "primary" }], expectedType: "modified" },
    { serviceCode: "97155", providerAssignments: [{ userId: "user-bcba", assignmentRole: "primary" }], expectedType: "modified" },
    { locationId: "location-school", expectedType: "modified" },
    { scheduledStartAt: "2026-08-11T10:00:00-04:00", scheduledEndAt: "2026-08-11T11:30:00-04:00", expectedType: "moved" }
  ];
  for (const edit of edits) {
    persisted = await readDb();
    const appointment = persisted.appointments.find((item) => item.id === appointmentId);
    const series = persisted.recurringAppointmentSeries[0];
    const { expectedType, ...editOverrides } = edit;
    const updated = await request(`/api/appointments/${appointmentId}`, {
      method: "PUT",
      cookie,
      body: occurrenceEditPayload(appointment, series, editOverrides)
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.version, appointment.version + 1);
    assert.equal(updated.json.recurrence.seriesVersion, series.version + 1);
    assert.equal(updated.json.recurrence.isException, true);
    assert.equal(updated.json.recurrence.exceptionType, expectedType);
    const after = await readDb();
    const stored = after.appointments.find((item) => item.id === appointmentId);
    assert.deepEqual(Object.fromEntries(Object.keys(originalIdentity).map((field) => [field, stored[field]])), originalIdentity);
    assert.equal(stored.recurrenceException.type, expectedType);
    assert.equal(stored.recurrenceException.baseRevisionId, originalIdentity.recurrenceRevisionId);
    assert.equal(stored.recurrenceException.createdBy, "user-admin");
    assert.ok(stored.recurrenceException.createdAt);
    assert.ok(stored.recurrenceException.operationId);
    assert.notEqual(stored.recurrenceException.operationId, priorOperationId);
    priorOperationId = stored.recurrenceException.operationId;
    assert.equal(after.recurringAppointmentSeries[0].version, series.version + 1);
    assert.deepEqual(after.recurringAppointmentSeries[0].revisions, originalTemplate);
  }

  persisted = await readDb();
  let appointment = persisted.appointments.find((item) => item.id === appointmentId);
  let series = persisted.recurringAppointmentSeries[0];
  const exceptionBeforeNoOp = structuredClone(appointment.recurrenceException);
  const noOp = await request(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    cookie,
    body: occurrenceEditPayload(appointment, series)
  });
  assert.equal(noOp.response.status, 200);
  persisted = await readDb();
  appointment = persisted.appointments.find((item) => item.id === appointmentId);
  series = persisted.recurringAppointmentSeries[0];
  assert.equal(appointment.version, 7);
  assert.equal(series.version, 6);
  assert.deepEqual(appointment.recurrenceException, exceptionBeforeNoOp);

  for (const injected of [
    { recurrenceException: { type: "modified" } },
    { recurrenceOccurrenceId: "attacker-occurrence" },
    { providerAssignments: [{ userId: "missing-provider", assignmentRole: "primary" }] }
  ]) {
    const before = await readDb();
    const rejected = await request(`/api/appointments/${appointmentId}`, {
      method: "PUT",
      cookie,
      body: occurrenceEditPayload(appointment, series, injected)
    });
    assert.equal(rejected.response.status, 400);
    const after = await readDb();
    assert.deepEqual(after.appointments, before.appointments);
    assert.deepEqual(after.recurringAppointmentSeries, before.recurringAppointmentSeries);
    assert.deepEqual(after.auditLog, before.auditLog);
  }

  const finalDb = await readDb();
  const seriesAudits = finalDb.auditLog.filter((entry) => entry.action === "recurring-series-occurrence-updated");
  assert.equal(seriesAudits.length, 5);
  assert.ok(seriesAudits.every((entry) => entry.details.scope === "this_appointment_only"));
  assert.equal(JSON.stringify(seriesAudits).includes("123 Authoritative Way"), false);
  assert.equal(JSON.stringify(seriesAudits).includes("Scheduling logistics only"), false);
});

test("recurring confirmation requires both current versions and increments the parent series atomically", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, { requestId: "recurring-confirmation-versioning" });
  let persisted = await readDb();
  const appointment = persisted.appointments[0];
  const identityFields = [
    "recurrenceSeriesId", "recurrenceRevisionId", "recurrenceRowId", "recurrenceOccurrenceId",
    "originalOccurrenceLocalDate", "originalOccurrenceStartAt", "generationKind"
  ];
  const originalIdentity = Object.fromEntries(identityFields.map((field) => [field, appointment[field]]));

  const missingSeriesVersion = await request(`/api/appointments/${appointment.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: appointment.version, status: "confirmed" }
  });
  assert.equal(missingSeriesVersion.response.status, 400);
  assert.match(missingSeriesVersion.json.errors.join(" "), /expectedSeriesVersion/);

  for (const versions of [
    { expectedVersion: appointment.version + 1, expectedSeriesVersion: 1 },
    { expectedVersion: appointment.version, expectedSeriesVersion: 2 }
  ]) {
    const before = await readDb();
    const stale = await request(`/api/appointments/${appointment.id}`, {
      method: "PUT",
      cookie,
      body: { ...versions, status: "confirmed" }
    });
    assert.equal(stale.response.status, 409);
    const after = await readDb();
    assert.deepEqual(after.appointments, before.appointments);
    assert.deepEqual(after.recurringAppointmentSeries, before.recurringAppointmentSeries);
    assert.deepEqual(after.auditLog, before.auditLog);
  }

  const confirmed = await request(`/api/appointments/${appointment.id}`, {
    method: "PUT",
    cookie,
    body: { expectedVersion: appointment.version, expectedSeriesVersion: 1, status: "confirmed" }
  });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.json.version, appointment.version + 1);
  assert.equal(confirmed.json.recurrence.seriesVersion, 2);
  assert.equal(confirmed.json.recurrence.isException, false);
  persisted = await readDb();
  const stored = persisted.appointments.find((item) => item.id === appointment.id);
  assert.equal(stored.status, "confirmed");
  assert.equal(stored.recurrenceException, null);
  assert.deepEqual(Object.fromEntries(identityFields.map((field) => [field, stored[field]])), originalIdentity);
  assert.equal(persisted.recurringAppointmentSeries[0].version, 2);
  const seriesAudits = persisted.auditLog.filter((entry) => entry.action === "recurring-series-occurrence-confirmed");
  assert.equal(seriesAudits.length, 1);
  assert.equal(seriesAudits[0].details.version, 2);
  assert.equal(JSON.stringify(seriesAudits).includes("Recurring Client"), false);
  assert.equal(JSON.stringify(seriesAudits).includes("123 Authoritative Way"), false);
  assert.equal(JSON.stringify(seriesAudits).includes("Scheduling logistics only"), false);
});

test("recurring cancellation requires both current versions and preserves cancellation and recurrence identity", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, { requestId: "recurring-cancellation-versioning" });
  let persisted = await readDb();
  const appointment = persisted.appointments[0];
  const identityFields = [
    "recurrenceSeriesId", "recurrenceRevisionId", "recurrenceRowId", "recurrenceOccurrenceId",
    "originalOccurrenceLocalDate", "originalOccurrenceStartAt", "generationKind"
  ];
  const originalIdentity = Object.fromEntries(identityFields.map((field) => [field, appointment[field]]));

  const missingSeriesVersion = await request(`/api/appointments/${appointment.id}/cancel`, {
    method: "POST",
    cookie,
    body: { expectedVersion: appointment.version, category: "client", reason: "client_cancelled" }
  });
  assert.equal(missingSeriesVersion.response.status, 400);
  assert.match(missingSeriesVersion.json.errors.join(" "), /expectedSeriesVersion/);

  for (const versions of [
    { expectedVersion: appointment.version + 1, expectedSeriesVersion: 1 },
    { expectedVersion: appointment.version, expectedSeriesVersion: 2 }
  ]) {
    const before = await readDb();
    const stale = await request(`/api/appointments/${appointment.id}/cancel`, {
      method: "POST",
      cookie,
      body: { ...versions, category: "provider", reason: "provider_cancelled", note: "Call caregiver." }
    });
    assert.equal(stale.response.status, 409);
    const after = await readDb();
    assert.deepEqual(after.appointments, before.appointments);
    assert.deepEqual(after.recurringAppointmentSeries, before.recurringAppointmentSeries);
    assert.deepEqual(after.auditLog, before.auditLog);
  }

  const cancelled = await request(`/api/appointments/${appointment.id}/cancel`, {
    method: "POST",
    cookie,
    body: {
      expectedVersion: appointment.version,
      expectedSeriesVersion: 1,
      category: "provider",
      reason: "provider_cancelled",
      note: "Call caregiver."
    }
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.json.version, appointment.version + 1);
  assert.equal(cancelled.json.recurrence.seriesVersion, 2);
  persisted = await readDb();
  const stored = persisted.appointments.find((item) => item.id === appointment.id);
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.cancellation.category, "provider");
  assert.equal(stored.cancellation.reason, "provider_cancelled");
  assert.equal(stored.cancellation.note, "Call caregiver.");
  assert.equal(stored.recurrenceException, null);
  assert.deepEqual(Object.fromEntries(identityFields.map((field) => [field, stored[field]])), originalIdentity);
  assert.equal(persisted.recurringAppointmentSeries[0].version, 2);
  const seriesAudits = persisted.auditLog.filter((entry) => entry.action === "recurring-series-occurrence-cancelled");
  assert.equal(seriesAudits.length, 1);
  assert.equal(seriesAudits[0].details.version, 2);
  assert.equal(JSON.stringify(seriesAudits).includes("Recurring Client"), false);
  assert.equal(JSON.stringify(seriesAudits).includes("Call caregiver."), false);
  assert.equal(JSON.stringify(seriesAudits).includes("provider_cancelled"), false);
  assert.equal(JSON.stringify(seriesAudits).includes("123 Authoritative Way"), false);
});

test("This and Future splits the governing revision and updates eligible future occurrences", async () => {
  await resetDb();
  const cookie = await login();
  const created = await createSeries(cookie, {
    requestId: "this-and-future-template-update",
    startDate: "2026-09-07",
    endDate: "2026-10-05"
  });
  assert.equal(created.response.status, 201);
  let persisted = await readDb();
  persisted.clients[0].profile.serviceLocations.push({
    ...structuredClone(location),
    id: "location-school",
    name: "School",
    settingType: "school",
    zone: "Doral",
    isPrimary: false
  });
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  persisted = await readDb();
  const series = persisted.recurringAppointmentSeries[0];
  const originalRevision = structuredClone(series.revisions[0]);
  const selected = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-09-14");
  const earlier = structuredClone(persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-09-07"));
  const originalOccurrenceIds = new Map(persisted.appointments.map((item) => (
    [item.originalOccurrenceLocalDate, item.recurrenceOccurrenceId]
  )));

  const result = await request(`/api/appointments/${selected.id}/this-and-future`, {
    method: "POST",
    cookie,
    body: thisAndFuturePayload(selected, series, {
      serviceCode: "97155",
      providerAssignments: [{ userId: "user-bcba", assignmentRole: "primary" }],
      scheduledStartAt: "2026-09-14T10:00:00-04:00",
      scheduledEndAt: "2026-09-14T11:00:00-04:00",
      locationId: "location-school",
      notes: "Future scheduling logistics."
    })
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual({
    seriesVersion: result.json.seriesVersion,
    effectiveDate: result.json.effectiveDate,
    updatedCount: result.json.updatedCount,
    createdCount: result.json.createdCount,
    cancelledCount: result.json.cancelledCount,
    protectedCount: result.json.protectedCount
  }, {
    seriesVersion: 2,
    effectiveDate: "2026-09-14",
    updatedCount: 4,
    createdCount: 0,
    cancelledCount: 0,
    protectedCount: 0
  });
  assert.ok(Array.isArray(result.json.collisionWarnings));
  assert.equal(JSON.stringify(result.json).includes(series.id), false);

  persisted = await readDb();
  const updatedSeries = persisted.recurringAppointmentSeries[0];
  assert.equal(updatedSeries.version, 2);
  assert.equal(updatedSeries.revisions.length, 2);
  assert.deepEqual(updatedSeries.revisions[0].template, originalRevision.template);
  assert.equal(updatedSeries.revisions[0].effectiveStartDate, "2026-09-07");
  assert.equal(updatedSeries.revisions[0].effectiveEndDate, "2026-09-13");
  assert.equal(updatedSeries.revisions[1].effectiveStartDate, "2026-09-14");
  assert.equal(updatedSeries.revisions[1].effectiveEndDate, "2026-10-05");
  assert.ok(updatedSeries.revisions.every((revision) => revision.status === "active"));
  assert.ok(updatedSeries.revisions.every((revision) => !revision.supersededByRevisionId));
  assert.equal(updatedSeries.revisions[1].template.rows[0].rowId, originalRevision.template.rows[0].rowId);
  assert.equal(updatedSeries.revisions[1].template.rows[0].weekday, 1);
  assert.equal(updatedSeries.revisions[1].template.rows[0].startLocalTime, "10:00");
  assert.equal(updatedSeries.revisions[1].template.serviceCode, "97155");
  assert.deepEqual(updatedSeries.revisions[1].template.providerAssignments, [
    { userId: "user-bcba", assignmentRole: "primary" }
  ]);
  assert.equal(updatedSeries.revisions[1].template.locationId, "location-school");
  assert.equal(updatedSeries.revisions[1].template.operationalNote, "Future scheduling logistics.");

  const storedEarlier = persisted.appointments.find((item) => item.id === earlier.id);
  assert.deepEqual(storedEarlier, earlier);
  const future = persisted.appointments.filter((item) => item.originalOccurrenceLocalDate >= "2026-09-14");
  assert.equal(future.length, 4);
  assert.ok(future.every((item) => item.scheduledStartAt.includes("T10:00:00-04:00")));
  assert.ok(future.every((item) => item.locationId === "location-school"));
  assert.ok(future.every((item) => item.serviceCode === "97155"));
  assert.ok(future.every((item) => item.providerAssignments[0].userId === "user-bcba"));
  assert.ok(future.every((item) => item.version === 2));
  assert.ok(future.every((item) => item.recurrenceRevisionId === updatedSeries.revisions[1].id));
  assert.ok(future.every((item) => item.recurrenceOccurrenceId === originalOccurrenceIds.get(item.originalOccurrenceLocalDate)));

  const audits = persisted.auditLog.filter((entry) => entry.action === "recurring-series-this-and-future-updated");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].details.scope, "this_and_future");
  assert.equal(audits[0].details.version, 2);
  assert.equal(audits[0].details.updatedCount, 4);
  const serializedAudit = JSON.stringify(audits[0]);
  assert.equal(serializedAudit.includes("Future scheduling logistics."), false);
  assert.equal(serializedAudit.includes("123 Authoritative Way"), false);
  assert.equal(serializedAudit.includes("Recurring Client"), false);
});

test("This and Future protects represented exceptions and uses system-safe removal identities", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, {
    requestId: "this-and-future-protected-removals",
    startDate: "2026-09-07",
    endDate: "2026-10-05"
  });
  let persisted = await readDb();
  const series = persisted.recurringAppointmentSeries[0];
  const selected = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-09-14");
  const protectedAppointment = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-09-21");
  protectedAppointment.status = "confirmed";
  protectedAppointment.version += 1;
  const protectedSnapshot = structuredClone(protectedAppointment);
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  const result = await request(`/api/appointments/${selected.id}/this-and-future`, {
    method: "POST",
    cookie,
    body: thisAndFuturePayload(selected, series, {
      scheduledStartAt: "2026-09-15T13:00:00-04:00",
      scheduledEndAt: "2026-09-15T14:30:00-04:00"
    })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.updatedCount, 0);
  assert.equal(result.json.cancelledCount, 3);
  assert.equal(result.json.createdCount, 3);
  assert.equal(result.json.protectedCount, 1);

  persisted = await readDb();
  const stillProtected = persisted.appointments.find((item) => item.id === protectedAppointment.id);
  assert.deepEqual(stillProtected, protectedSnapshot);
  const removed = persisted.appointments.filter((item) => (
    item.originalOccurrenceLocalDate >= "2026-09-14"
    && item.status === "cancelled"
    && item.recurrenceException?.type === "removed_by_series"
  ));
  assert.equal(removed.length, 3);
  for (const appointment of removed) {
    assert.equal(appointment.cancellation.category, "system");
    assert.equal(appointment.cancellation.reason, "recurrence_schedule_change");
    assert.equal(appointment.cancellation.note, "");
    assert.ok(appointment.recurrenceOccurrenceId);
    assert.ok(appointment.originalOccurrenceLocalDate);
    assert.ok(appointment.originalOccurrenceStartAt);
  }
  const createdDates = persisted.appointments.filter((item) => (
    item.recurrenceRevisionId === persisted.recurringAppointmentSeries[0].revisions[1].id
    && item.version === 1
  )).map((item) => item.originalOccurrenceLocalDate).sort();
  assert.deepEqual(createdDates, ["2026-09-15", "2026-09-22", "2026-09-29"]);
  assert.equal(new Set(persisted.appointments.map((item) => item.recurrenceOccurrenceId)).size, persisted.appointments.length);
});

test("This and Future leaves every protected occurrence class unchanged while reconciling later eligible slots", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, {
    requestId: "this-and-future-all-protections",
    startDate: "2026-09-07",
    endDate: "2026-11-02"
  });
  let persisted = await readDb();
  const byDate = new Map(persisted.appointments.map((item) => [item.originalOccurrenceLocalDate, item]));
  byDate.get("2026-09-14").status = "confirmed";
  byDate.get("2026-09-14").version += 1;
  byDate.get("2026-09-21").status = "completed";
  byDate.get("2026-09-28").status = "no_show";
  byDate.get("2026-10-05").status = "cancelled";
  byDate.get("2026-10-05").cancellation = {
    category: "client", reason: "client_cancelled", note: "Existing cancellation",
    cancelledAt: "2026-08-30T12:00:00.000Z", cancelledBy: "user-admin"
  };
  byDate.get("2026-10-12").recurrenceException = {
    type: "modified", baseRevisionId: byDate.get("2026-10-12").recurrenceRevisionId,
    operationId: "prior-modification", createdAt: "2026-08-30T12:00:00.000Z", createdBy: "user-admin"
  };
  byDate.get("2026-10-19").recurrenceException = {
    type: "moved", baseRevisionId: byDate.get("2026-10-19").recurrenceRevisionId,
    operationId: "prior-move", createdAt: "2026-08-30T12:00:00.000Z", createdBy: "user-admin"
  };
  byDate.get("2026-10-26").sessionId = "session-sentinel";
  byDate.get("2026-10-26").linkedAt = "2026-08-30T12:00:00.000Z";
  byDate.get("2026-10-26").linkedBy = "user-admin";
  const selected = byDate.get("2026-09-14");
  const series = persisted.recurringAppointmentSeries[0];
  const protectedIds = [...byDate.entries()]
    .filter(([date]) => date >= "2026-09-14" && date <= "2026-10-26")
    .map(([, appointment]) => appointment.id);
  const protectedSnapshots = new Map(protectedIds.map((id) => [
    id, structuredClone(persisted.appointments.find((item) => item.id === id))
  ]));
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  const result = await request(`/api/appointments/${selected.id}/this-and-future`, {
    method: "POST",
    cookie,
    body: thisAndFuturePayload(selected, series, {
      scheduledStartAt: "2026-09-14T12:00:00-04:00",
      scheduledEndAt: "2026-09-14T13:30:00-04:00"
    })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.protectedCount, 7);
  assert.equal(result.json.updatedCount, 1);
  assert.equal(result.json.createdCount, 0);
  assert.equal(result.json.cancelledCount, 0);

  persisted = await readDb();
  for (const [id, snapshot] of protectedSnapshots) {
    assert.deepEqual(persisted.appointments.find((item) => item.id === id), snapshot);
  }
  const eligible = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-11-02");
  assert.equal(eligible.scheduledStartAt, "2026-11-02T12:00:00-05:00");
  assert.equal(eligible.version, 2);
});

test("This and Future rejects missing, stale, boundary, and concurrent versions with zero partial mutation", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, {
    requestId: "this-and-future-concurrency",
    startDate: "2026-09-07",
    endDate: "2026-10-05"
  });
  let persisted = await readDb();
  const series = persisted.recurringAppointmentSeries[0];
  const boundary = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-09-07");
  const selected = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-09-14");

  for (const [overrides, status, pattern] of [
    [{ expectedAppointmentVersion: undefined }, 400, /expectedAppointmentVersion/],
    [{ expectedSeriesVersion: undefined }, 400, /expectedSeriesVersion/],
    [{ expectedAppointmentVersion: selected.version + 1 }, 409, /Appointment has changed/],
    [{ expectedSeriesVersion: series.version + 1 }, 409, /series has changed/]
  ]) {
    const before = await readDb();
    const rejected = await request(`/api/appointments/${selected.id}/this-and-future`, {
      method: "POST",
      cookie,
      body: thisAndFuturePayload(selected, series, overrides)
    });
    assert.equal(rejected.response.status, status);
    assert.match(rejected.json.errors.join(" "), pattern);
    assert.deepEqual(await readDb(), before);
  }

  const beforeBoundary = await readDb();
  const boundaryResult = await request(`/api/appointments/${boundary.id}/this-and-future`, {
    method: "POST",
    cookie,
    body: thisAndFuturePayload(boundary, series)
  });
  assert.equal(boundaryResult.response.status, 400);
  assert.match(boundaryResult.json.errors.join(" "), /begins the current series revision/);
  assert.deepEqual(await readDb(), beforeBoundary);

  const payload = thisAndFuturePayload(selected, series, {
    scheduledStartAt: "2026-09-14T11:00:00-04:00",
    scheduledEndAt: "2026-09-14T12:00:00-04:00"
  });
  const concurrent = await Promise.all([
    request(`/api/appointments/${selected.id}/this-and-future`, { method: "POST", cookie, body: payload }),
    request(`/api/appointments/${selected.id}/this-and-future`, { method: "POST", cookie, body: payload })
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 409]);
  persisted = await readDb();
  assert.equal(persisted.recurringAppointmentSeries[0].version, 2);
  assert.equal(persisted.recurringAppointmentSeries[0].revisions.length, 2);
  assert.equal(persisted.auditLog.filter((entry) => entry.action === "recurring-series-this-and-future-updated").length, 1);
});

test("Entire Series future uses the earliest boundary and replaces the complete future pattern", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, {
    requestId: "entire-series-future-pattern",
    startDate: "2026-09-07",
    endDate: "2026-10-05"
  });
  let persisted = await readDb();
  persisted.clients[0].profile.serviceLocations.push({
    ...structuredClone(location), id: "location-school", name: "School",
    settingType: "school", zone: "Doral", isPrimary: false
  });
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  persisted = await readDb();
  const series = persisted.recurringAppointmentSeries[0];
  const originalRevision = structuredClone(series.revisions[0]);
  const selected = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-10-05");
  const result = await request(`/api/appointments/${selected.id}/entire-series-future`, {
    method: "POST",
    cookie,
    body: entireSeriesFuturePayload(selected, series, {
      serviceCode: "97155",
      providerAssignments: [{ userId: "user-bcba", assignmentRole: "primary" }],
      locationId: "location-school",
      notes: "Future pattern logistics.",
      recurrenceRows: [
        { weekday: 1, startLocalTime: "10:00", endLocalTime: "12:00" },
        { weekday: 3, startLocalTime: "10:00", endLocalTime: "12:00" },
        { weekday: 5, startLocalTime: "09:00", endLocalTime: "11:00" }
      ]
    })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.effectiveDate, "2026-09-07");
  assert.equal(result.json.seriesVersion, 2);
  assert.equal(result.json.updatedCount, 5);
  assert.equal(result.json.createdCount, 8);
  assert.equal(result.json.cancelledCount, 0);
  assert.equal(result.json.protectedCount, 0);
  assert.equal(JSON.stringify(result.json).includes(series.id), false);

  persisted = await readDb();
  const updatedSeries = persisted.recurringAppointmentSeries[0];
  assert.equal(updatedSeries.version, 2);
  assert.equal(updatedSeries.revisions.length, 2);
  const superseded = updatedSeries.revisions.find((revision) => revision.status === "superseded");
  const active = updatedSeries.revisions.find((revision) => revision.status === "active");
  assert.deepEqual(superseded.template, originalRevision.template);
  assert.equal(superseded.effectiveStartDate, "2026-09-07");
  assert.equal(superseded.effectiveEndDate, "2026-10-05");
  assert.equal(superseded.supersededByRevisionId, active.id);
  assert.equal(active.effectiveStartDate, "2026-09-07");
  assert.equal(active.effectiveEndDate, "2026-10-05");
  assert.deepEqual(active.template.rows.map((row) => [row.weekday, row.startLocalTime, row.endLocalTime]), [
    [1, "10:00", "12:00"], [3, "10:00", "12:00"], [5, "09:00", "11:00"]
  ]);
  assert.equal(active.template.serviceCode, "97155");
  assert.equal(active.template.providerAssignments[0].userId, "user-bcba");
  assert.equal(active.template.locationId, "location-school");
  assert.equal(active.template.locationSnapshot.label, "School");
  assert.equal(active.template.operationalNote, "Future pattern logistics.");
  assert.equal(new Set(persisted.appointments.map((item) => item.recurrenceOccurrenceId)).size, persisted.appointments.length);
  const operationAudits = persisted.auditLog.filter((entry) => entry.action === "recurring-series-future-updated");
  assert.equal(operationAudits.length, 1);
  assert.equal(operationAudits[0].details.scope, "entire_series_future");
  assert.equal(operationAudits[0].details.version, 2);
  assert.equal(JSON.stringify(operationAudits[0]).includes("Future pattern logistics."), false);
  assert.equal(JSON.stringify(operationAudits[0]).includes("123 Authoritative Way"), false);
});

test("Entire Series future leaves past and protected appointments unchanged and retains removed slots", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, {
    requestId: "entire-series-protection",
    startDate: "2026-08-24",
    endDate: "2026-10-26"
  });
  let persisted = await readDb();
  const byDate = new Map(persisted.appointments.map((item) => [item.originalOccurrenceLocalDate, item]));
  const pastSnapshots = ["2026-08-24", "2026-08-31"].map((date) => structuredClone(byDate.get(date)));
  byDate.get("2026-09-07").status = "confirmed";
  byDate.get("2026-09-14").status = "completed";
  byDate.get("2026-09-21").status = "cancelled";
  byDate.get("2026-09-28").status = "no_show";
  byDate.get("2026-10-05").sessionId = "session-sentinel";
  byDate.get("2026-10-05").linkedAt = "2026-08-31T12:00:00.000Z";
  byDate.get("2026-10-05").linkedBy = "user-admin";
  byDate.get("2026-10-12").recurrenceException = {
    type: "modified", baseRevisionId: byDate.get("2026-10-12").recurrenceRevisionId,
    operationId: "prior-modification", createdAt: "2026-08-31T12:00:00.000Z", createdBy: "user-admin"
  };
  byDate.get("2026-10-19").recurrenceException = {
    type: "moved", baseRevisionId: byDate.get("2026-10-19").recurrenceRevisionId,
    operationId: "prior-move", createdAt: "2026-08-31T12:00:00.000Z", createdBy: "user-admin"
  };
  const protectedIds = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]
    .map((date) => byDate.get(date).id);
  const protectedSnapshots = new Map(protectedIds.map((id) => [
    id, structuredClone(persisted.appointments.find((item) => item.id === id))
  ]));
  const selected = byDate.get("2026-10-26");
  const series = persisted.recurringAppointmentSeries[0];
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  const result = await request(`/api/appointments/${selected.id}/entire-series-future`, {
    method: "POST",
    cookie,
    body: entireSeriesFuturePayload(selected, series, {
      recurrenceRows: [{ weekday: 2, startLocalTime: "13:00", endLocalTime: "14:30" }]
    })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.effectiveDate, "2026-09-01");
  assert.equal(result.json.protectedCount, 7);
  assert.equal(result.json.cancelledCount, 1);
  assert.equal(result.json.createdCount, 8);

  persisted = await readDb();
  for (const snapshot of pastSnapshots) {
    assert.deepEqual(persisted.appointments.find((item) => item.id === snapshot.id), snapshot);
  }
  for (const [id, snapshot] of protectedSnapshots) {
    assert.deepEqual(persisted.appointments.find((item) => item.id === id), snapshot);
  }
  const removed = persisted.appointments.find((item) => item.id === selected.id);
  assert.equal(removed.status, "cancelled");
  assert.equal(removed.cancellation.category, "system");
  assert.equal(removed.cancellation.reason, "recurrence_schedule_change");
  assert.equal(removed.recurrenceException.type, "removed_by_series");
  assert.ok(removed.recurrenceOccurrenceId);
  assert.equal(new Set(persisted.appointments.map((item) => item.recurrenceOccurrenceId)).size, persisted.appointments.length);
});

test("Entire Series future rejects invalid rows and stale versions with atomic zero mutation", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, {
    requestId: "entire-series-validation",
    startDate: "2026-09-07",
    endDate: "2026-10-05"
  });
  const persisted = await readDb();
  const series = persisted.recurringAppointmentSeries[0];
  const selected = persisted.appointments.at(-1);
  const cases = [
    [entireSeriesFuturePayload(selected, series, { expectedAppointmentVersion: selected.version + 1 }), 409],
    [entireSeriesFuturePayload(selected, series, { expectedSeriesVersion: series.version + 1 }), 409],
    [entireSeriesFuturePayload(selected, series, { recurrenceRows: [
      { weekday: 1, startLocalTime: "09:00", endLocalTime: "10:00" },
      { weekday: 1, startLocalTime: "11:00", endLocalTime: "12:00" }
    ] }), 400],
    [entireSeriesFuturePayload(selected, series, { recurrenceRows: [
      { weekday: 2, startLocalTime: "14:00", endLocalTime: "13:00" }
    ] }), 400],
    [entireSeriesFuturePayload(selected, series, { recurrenceRows: Array.from({ length: 8 }, (_, weekday) => ({
      weekday, startLocalTime: "09:00", endLocalTime: "10:00"
    })) }), 400]
  ];
  for (const [body, status] of cases) {
    const before = await readDb();
    const result = await request(`/api/appointments/${selected.id}/entire-series-future`, {
      method: "POST", cookie, body
    });
    assert.equal(result.response.status, status);
    assert.deepEqual(await readDb(), before);
  }
});

test("Entire Series future preserves and replaces later active revision segments", async () => {
  await resetDb();
  const cookie = await login();
  await createSeries(cookie, {
    requestId: "entire-series-existing-revisions",
    startDate: "2026-09-07",
    endDate: "2026-10-05"
  });
  let persisted = await readDb();
  let series = persisted.recurringAppointmentSeries[0];
  let selected = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-09-14");
  const split = await request(`/api/appointments/${selected.id}/this-and-future`, {
    method: "POST",
    cookie,
    body: thisAndFuturePayload(selected, series, {
      scheduledStartAt: "2026-09-14T10:00:00-04:00",
      scheduledEndAt: "2026-09-14T11:00:00-04:00"
    })
  });
  assert.equal(split.response.status, 200);

  persisted = await readDb();
  series = persisted.recurringAppointmentSeries[0];
  const historicalRevisions = structuredClone(series.revisions);
  selected = persisted.appointments.find((item) => item.originalOccurrenceLocalDate === "2026-10-05");
  const result = await request(`/api/appointments/${selected.id}/entire-series-future`, {
    method: "POST",
    cookie,
    body: entireSeriesFuturePayload(selected, series, {
      recurrenceRows: [{ weekday: 3, startLocalTime: "12:00", endLocalTime: "13:30" }]
    })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.effectiveDate, "2026-09-07");
  assert.equal(result.json.seriesVersion, 3);

  persisted = await readDb();
  series = persisted.recurringAppointmentSeries[0];
  assert.equal(series.revisions.length, 4);
  assert.equal(series.revisions.filter((revision) => revision.status === "superseded").length, 2);
  const active = series.revisions.filter((revision) => revision.status === "active")
    .sort((left, right) => left.effectiveStartDate.localeCompare(right.effectiveStartDate));
  assert.deepEqual(active.map((revision) => [revision.effectiveStartDate, revision.effectiveEndDate]), [
    ["2026-09-07", "2026-09-13"], ["2026-09-14", "2026-10-05"]
  ]);
  assert.ok(active.every((revision) => revision.template.rows[0].weekday === 3));
  for (const historical of historicalRevisions) {
    const stored = series.revisions.find((revision) => revision.id === historical.id);
    assert.deepEqual(stored.template, historical.template);
    assert.equal(stored.effectiveStartDate, historical.effectiveStartDate);
    assert.equal(stored.effectiveEndDate, historical.effectiveEndDate);
  }
});
