import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-service-locations-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";

const dbPath = process.env.DB_PATH;
const legacyClient = {
  id: "client-1",
  name: "Clinical Sentinel",
  agency: "Triumph ABA",
  status: "active",
  defaultSetting: "Home and school",
  profile: {
    school: "Existing School",
    documents: [{ id: "document-1", fileName: "sentinel.pdf" }],
    authorization: { number: "AUTH-1", services: {} },
    intakeInterview: { schoolSetting: "Existing classroom" },
    funderReport: { narrative: "Report sentinel" },
    graphPhaseLines: { "behavior:one": [{ id: "line-1", date: "2026-08-01" }] }
  },
  domains: ["Functional Communication"],
  programs: [{ id: "program-1", name: "Manding", targets: [] }],
  behaviors: [],
  planChangeLog: [{ id: "change-1", sessionId: "session-1", serviceCode: "97155" }],
  note97151History: [{ id: "note-1", note: "Finalized assessment", status: "finalized" }],
  note97155History: [{ id: "note-2", note: "Finalized protocol note", status: "finalized" }]
};
const clinicalSession = {
  id: "session-1",
  clientId: "client-1",
  agency: "Triumph ABA",
  date: "2026-08-01",
  serviceType: "97153",
  soapNote: "Finalized SOAP sentinel",
  finalized: true,
  finalizedSnapshot: { soapNote: "Finalized SOAP sentinel" },
  amendments: [{ id: "amendment-1", reason: "Sentinel" }]
};
const existingAppointment = {
  id: "appointment-sentinel",
  agency: "Triumph ABA",
  clientId: "client-1",
  serviceCode: "97153",
  providerAssignments: [{ userId: "user-rbt", assignmentRole: "primary" }],
  scheduledStartAt: "2026-08-03T09:00:00-04:00",
  scheduledEndAt: "2026-08-03T10:00:00-04:00",
  timeZone: "America/New_York",
  status: "scheduled",
  settingType: "home",
  locationId: "legacy-home",
  locationSnapshot: { label: "Old Home", addressLine1: "Historical address" },
  version: 1
};
const baseDb = {
  clients: [legacyClient],
  sessions: [clinicalSession],
  appointments: [existingAppointment],
  historicalImportBatches: [{ id: "import-1", clientId: "client-1", agency: "Triumph ABA" }],
  auditLog: [],
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

async function resetDb(nextDb = baseDb) {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify(structuredClone(nextDb), null, 2)}\n`, "utf8");
}

async function persistedDb() {
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
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

function locationPayload(overrides = {}) {
  return {
    name: "Home",
    settingType: "home",
    zone: "West Kendall",
    address: { line1: "", line2: "", city: "", state: "FL", postalCode: "" },
    operationalNote: "Use side gate.",
    isPrimary: false,
    ...overrides
  };
}

async function addLocation(cookie, payload = locationPayload()) {
  return request("/api/clients/client-1/service-locations", { method: "POST", cookie, body: payload });
}

test("legacy clients load without a service-location rewrite and keep defaultSetting", async () => {
  await resetDb();
  const cookie = await login();
  const result = await request("/api/data", { cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.clients[0].defaultSetting, "Home and school");
  assert.equal(result.json.clients[0].profile.serviceLocations, undefined);
  const persisted = await persistedDb();
  assert.equal(persisted.clients[0].defaultSetting, "Home and school");
  assert.equal(persisted.clients[0].profile.serviceLocations, undefined);
});

test("Home and School locations accept optional addresses, require approved zones, and receive stable IDs", async () => {
  await resetDb();
  const cookie = await login();

  const missingZone = await addLocation(cookie, locationPayload({ zone: "" }));
  assert.equal(missingZone.response.status, 400);
  assert.match(missingZone.json.errors.join(" "), /approved geographic zone/i);

  const freeTextZone = await addLocation(cookie, locationPayload({ zone: "Somewhere Else" }));
  assert.equal(freeTextZone.response.status, 400);

  const home = await addLocation(cookie);
  assert.equal(home.response.status, 201);
  const savedHome = home.json.profile.serviceLocations[0];
  assert.match(savedHome.id, /^[0-9a-f-]{36}$/i);
  assert.equal(savedHome.zone, "West Kendall");
  assert.equal(savedHome.address.line1, "");
  assert.equal(savedHome.isPrimary, true);
  assert.equal(savedHome.isActive, true);
  assert.ok(Date.parse(savedHome.createdAt));

  const school = await addLocation(cookie, locationPayload({
    name: "School",
    settingType: "school",
    zone: "Doral",
    address: undefined,
    operationalNote: "Dismissal is at 2:15."
  }));
  assert.equal(school.response.status, 201);
  assert.equal(school.json.profile.serviceLocations[1].address.line1, "");
  assert.equal(school.json.profile.serviceLocations[1].zone, "Doral");
});

test("editing, Primary changes, and deactivation preserve stable records and clinical data", async () => {
  await resetDb();
  const cookie = await login();
  const clinicalBefore = await persistedDb();
  const homeResult = await addLocation(cookie);
  const home = homeResult.json.profile.serviceLocations[0];
  const schoolResult = await addLocation(cookie, locationPayload({ name: "School", settingType: "school", zone: "Doral", isPrimary: true }));
  const school = schoolResult.json.profile.serviceLocations[1];
  assert.equal(schoolResult.json.profile.serviceLocations[0].isPrimary, false);
  assert.equal(school.isPrimary, true);

  const edit = await request(`/api/clients/client-1/service-locations/${home.id}`, {
    method: "PUT",
    cookie,
    body: locationPayload({ name: "Mom's House", zone: "Kendall", isPrimary: true })
  });
  assert.equal(edit.response.status, 200);
  const editedHome = edit.json.profile.serviceLocations.find((item) => item.id === home.id);
  assert.equal(editedHome.name, "Mom's House");
  assert.equal(editedHome.id, home.id);
  assert.equal(editedHome.isPrimary, true);
  assert.equal(edit.json.profile.serviceLocations.find((item) => item.id === school.id).isPrimary, false);

  const deactivate = await request(`/api/clients/client-1/service-locations/${home.id}/deactivate`, { method: "POST", cookie });
  assert.equal(deactivate.response.status, 200);
  const inactiveHome = deactivate.json.profile.serviceLocations.find((item) => item.id === home.id);
  assert.equal(inactiveHome.isActive, false);
  assert.equal(inactiveHome.isPrimary, false);
  assert.equal(deactivate.json.profile.serviceLocations.length, 2);

  const persisted = await persistedDb();
  assert.deepEqual(persisted.sessions, clinicalBefore.sessions);
  assert.deepEqual(persisted.appointments, clinicalBefore.appointments);
  assert.deepEqual(persisted.clients[0].programs, clinicalBefore.clients[0].programs);
  assert.deepEqual(persisted.clients[0].planChangeLog, clinicalBefore.clients[0].planChangeLog);
  assert.deepEqual(persisted.clients[0].note97151History, clinicalBefore.clients[0].note97151History);
  assert.deepEqual(persisted.clients[0].note97155History, clinicalBefore.clients[0].note97155History);
  assert.equal(persisted.clients[0].profile.school, clinicalBefore.clients[0].profile.school);
  assert.deepEqual(persisted.clients[0].profile.intakeInterview, clinicalBefore.clients[0].profile.intakeInterview);
  assert.deepEqual(persisted.clients[0].profile.funderReport, clinicalBefore.clients[0].profile.funderReport);
  assert.deepEqual(persisted.clients[0].profile.graphPhaseLines, clinicalBefore.clients[0].profile.graphPhaseLines);
  assert.deepEqual(persisted.clients[0].profile.documents, clinicalBefore.clients[0].profile.documents);
  assert.equal(persisted.clients[0].defaultSetting, "Home and school");
  const locationAudits = persisted.auditLog.filter((entry) => entry.action.startsWith("client-service-location-"));
  assert.ok(locationAudits.length >= 4);
  assert.ok(locationAudits.every((entry) => !JSON.stringify(entry.details).includes("Historical address")));
  assert.ok(locationAudits.every((entry) => !JSON.stringify(entry.details).includes("Use side gate")));
});

test("admin and BCBA can manage locations while RBT and read-only roles cannot", async () => {
  await resetDb();
  const rbtCookie = await login("rbt", "rbt123");
  assert.equal((await addLocation(rbtCookie)).response.status, 403);
  const readOnlyCookie = await login("readonly", "readonly123");
  assert.equal((await addLocation(readOnlyCookie)).response.status, 403);
  const bcbaCookie = await login("bcba", "bcba123");
  assert.equal((await addLocation(bcbaCookie)).response.status, 201);
});

test("appointment creation excludes inactive structured locations and snapshots active saved data", async () => {
  await resetDb();
  const cookie = await login();
  const homeResult = await addLocation(cookie, locationPayload({ address: { line1: "123 Saved Way", city: "Miami", state: "FL" } }));
  const home = homeResult.json.profile.serviceLocations[0];
  const schoolResult = await addLocation(cookie, locationPayload({ name: "School", settingType: "school", zone: "Doral" }));
  const school = schoolResult.json.profile.serviceLocations[1];
  await request(`/api/clients/client-1/service-locations/${school.id}/deactivate`, { method: "POST", cookie });

  const baseAppointment = {
    clientId: "client-1",
    serviceCode: "97153",
    providerAssignments: [{ userId: "user-rbt", assignmentRole: "primary" }],
    scheduledStartAt: "2026-08-04T09:00:00-04:00",
    scheduledEndAt: "2026-08-04T10:00:00-04:00",
    timeZone: "America/New_York",
    locationSnapshot: { label: "Spoofed", addressLine1: "Wrong address" }
  };
  const inactive = await request("/api/appointments", {
    method: "POST", cookie, body: { ...baseAppointment, locationId: school.id, settingType: "school" }
  });
  assert.equal(inactive.response.status, 400);
  assert.match(inactive.json.errors.join(" "), /active service location/i);

  const active = await request("/api/appointments", {
    method: "POST", cookie, body: { ...baseAppointment, locationId: home.id, settingType: "other" }
  });
  assert.equal(active.response.status, 201);
  assert.equal(active.json.locationId, home.id);
  assert.equal(active.json.settingType, "home");
  assert.equal(active.json.locationSnapshot.label, "Home");
  assert.equal(active.json.locationSnapshot.zone, "West Kendall");
  assert.equal(active.json.locationSnapshot.addressLine1, "123 Saved Way");
  assert.equal(active.json.locationSnapshot.operationalNote, "Use side gate.");
  const details = await request(`/api/appointments/${active.json.id}`, { cookie });
  assert.equal(details.response.status, 200);
  assert.equal(details.json.locationSnapshot.zone, "West Kendall");
  const persisted = await persistedDb();
  assert.deepEqual(
    persisted.appointments.find((item) => item.id === "appointment-sentinel").locationSnapshot,
    existingAppointment.locationSnapshot
  );
});

test("profile saves retain locations and backup/restore round-trips them while legacy backups remain valid", async () => {
  await resetDb();
  const cookie = await login();
  const created = await addLocation(cookie);
  const locationId = created.json.profile.serviceLocations[0].id;
  const profileSave = await request("/api/clients/client-1/profile", {
    method: "PUT",
    cookie,
    body: { name: "Clinical Sentinel", defaultSetting: "Home and school", status: "active" }
  });
  assert.equal(profileSave.response.status, 200);
  assert.equal(profileSave.json.profile.serviceLocations[0].id, locationId);

  const backup = await request("/api/backup", { cookie });
  assert.equal(backup.response.status, 200);
  assert.equal(backup.json.data.clients[0].profile.serviceLocations[0].id, locationId);
  const restore = await request("/api/backup/restore", { method: "POST", cookie, body: backup.json });
  assert.equal(restore.response.status, 200);
  assert.equal((await persistedDb()).clients[0].profile.serviceLocations[0].id, locationId);

  const legacyBackup = structuredClone(backup.json);
  delete legacyBackup.data.clients[0].profile.serviceLocations;
  const legacyRestore = await request("/api/backup/restore", { method: "POST", cookie, body: legacyBackup });
  assert.equal(legacyRestore.response.status, 200);
  assert.equal((await persistedDb()).clients[0].profile.serviceLocations, undefined);
});
