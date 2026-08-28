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
