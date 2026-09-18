import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sanitizeProviderAvailabilityInput,
  sanitizeWeeklyProviderAvailability
} from "../lib/provider-availability.mjs";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-provider-availability-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";

const dbPath = process.env.DB_PATH;
const baseDb = {
  clients: [],
  sessions: [],
  appointments: [],
  recurringAppointmentSeries: [],
  historicalImportBatches: [],
  auditLog: [],
  users: [],
  clientUserAssignments: []
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

async function readDb() {
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

async function login(username = "admin", password = "admin123") {
  const result = await request("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

function weeklyAvailability(overrides = {}) {
  return {
    monday: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
    ...overrides
  };
}

function availabilityPayload(overrides = {}) {
  return {
    providerUserId: "user-rbt",
    effectiveDate: "2026-09-21",
    timezone: "America/New_York",
    weeklyAvailability: weeklyAvailability(),
    ...overrides
  };
}

test("availability model normalizes all weekdays and sorts multiple blocks", () => {
  const result = sanitizeProviderAvailabilityInput(availabilityPayload({
    weeklyAvailability: { monday: [{ start: "13:00", end: "17:00" }, { start: "09:00", end: "12:00" }] }
  }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.availability.weeklyAvailability.monday, [
    { start: "09:00", end: "12:00" },
    { start: "13:00", end: "17:00" }
  ]);
  assert.deepEqual(Object.keys(result.availability.weeklyAvailability), [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
  ]);
  assert.equal(result.availability.timezone, "America/New_York");
});

test("availability model rejects malformed, duplicate, overlapping, and cross-midnight blocks", () => {
  const malformed = sanitizeProviderAvailabilityInput({
    effectiveDate: "2026-02-30",
    timezone: "Not/A_Timezone",
    weeklyAvailability: weeklyAvailability({
      monday: [
        { start: "09:00", end: "12:00" },
        { start: "09:00", end: "12:00" },
        { start: "11:30", end: "13:00" },
        { start: "22:00", end: "06:00" },
        { start: "25:00", end: "26:00" }
      ]
    })
  });
  const message = malformed.errors.join(" ");
  assert.match(message, /valid YYYY-MM-DD/);
  assert.match(message, /valid IANA timezone/);
  assert.match(message, /duplicate/);
  assert.match(message, /overlap/);
  assert.match(message, /cross-midnight/);
  assert.match(message, /valid HH:MM/);

  const unknownDay = sanitizeWeeklyProviderAvailability({ monday: [], holiday: [] });
  assert.match(unknownDay.errors.join(" "), /Unsupported availability day/);
});

test("legacy state initializes availability and only Admin or BCBA can access its API", async () => {
  await resetDb();
  const adminCookie = await login();
  const result = await request("/api/provider-availability", { cookie: adminCookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.profiles, []);
  assert.deepEqual(result.json.providers.map((provider) => provider.role).sort(), ["bcba", "rbt"]);
  assert.deepEqual((await readDb()).providerAvailabilityProfiles, []);

  const bcbaCookie = await login("bcba", "bcba123");
  assert.equal((await request("/api/provider-availability", { cookie: bcbaCookie })).response.status, 200);
  const rbtCookie = await login("rbt", "rbt123");
  assert.equal((await request("/api/provider-availability", { cookie: rbtCookie })).response.status, 403);
  const readOnlyCookie = await login("readonly", "readonly123");
  assert.equal((await request("/api/provider-availability", { cookie: readOnlyCookie })).response.status, 403);
  assert.equal((await request("/api/provider-availability")).response.status, 401);
});

test("Admin creates and BCBA reads, updates, deactivates, and reactivates organization-wide availability", async () => {
  await resetDb();
  const adminCookie = await login();
  const initialized = await readDb();
  initialized.users.find((user) => user.id === "user-admin").agency = "Legacy Admin Agency";
  initialized.users.find((user) => user.id === "user-bcba").agency = "Legacy BCBA Agency";
  initialized.users.find((user) => user.id === "user-rbt").agency = "Legacy RBT Agency";
  await writeFile(dbPath, `${JSON.stringify(initialized, null, 2)}\n`, "utf8");

  const created = await request("/api/provider-availability", {
    method: "POST",
    cookie: adminCookie,
    body: availabilityPayload()
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.json.providerUserId, "user-rbt");
  assert.equal(created.json.version, 1);
  assert.equal(created.json.active, true);
  assert.ok(created.json.id);
  assert.equal(created.json.createdByUserId, "user-admin");
  assert.equal(created.json.updatedByUserId, "user-admin");

  const bcbaCookie = await login("bcba", "bcba123");
  const read = await request("/api/provider-availability/user-rbt", { cookie: bcbaCookie });
  assert.equal(read.response.status, 200);
  assert.equal(read.json.profile.id, created.json.id);

  const updated = await request("/api/provider-availability/user-rbt", {
    method: "PUT",
    cookie: bcbaCookie,
    body: {
      ...availabilityPayload({
        effectiveDate: "2026-09-28",
        weeklyAvailability: weeklyAvailability({ tuesday: [{ start: "10:00", end: "15:00" }] })
      }),
      expectedVersion: 1
    }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.version, 2);
  assert.equal(updated.json.updatedByUserId, "user-bcba");
  assert.deepEqual(updated.json.weeklyAvailability.tuesday, [{ start: "10:00", end: "15:00" }]);

  const stale = await request("/api/provider-availability/user-rbt", {
    method: "PUT",
    cookie: adminCookie,
    body: { ...availabilityPayload(), expectedVersion: 1 }
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.json.currentVersion, 2);

  const deactivated = await request("/api/provider-availability/user-rbt/deactivate", {
    method: "POST",
    cookie: bcbaCookie,
    body: { expectedVersion: 2 }
  });
  assert.equal(deactivated.response.status, 200);
  assert.equal(deactivated.json.active, false);
  assert.equal(deactivated.json.version, 3);

  const reactivated = await request("/api/provider-availability/user-rbt", {
    method: "PUT",
    cookie: adminCookie,
    body: { ...availabilityPayload(), expectedVersion: 3 }
  });
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.json.active, true);
  assert.equal(reactivated.json.version, 4);

  const persisted = await readDb();
  assert.equal(persisted.providerAvailabilityProfiles.length, 1);
  assert.equal(persisted.auditLog.filter((entry) => entry.action.startsWith("provider-availability-")).length, 4);
  assert.equal("agency" in persisted.providerAvailabilityProfiles[0], false);
});

test("create/update enforce eligible providers, one profile, validation, versions, and role checks", async () => {
  await resetDb();
  const adminCookie = await login();
  const rbtCookie = await login("rbt", "rbt123");
  const readOnlyCookie = await login("readonly", "readonly123");

  const invalidProvider = await request("/api/provider-availability", {
    method: "POST",
    cookie: adminCookie,
    body: availabilityPayload({ providerUserId: "user-admin" })
  });
  assert.equal(invalidProvider.response.status, 400);

  const invalidShape = await request("/api/provider-availability", {
    method: "POST",
    cookie: adminCookie,
    body: availabilityPayload({
      effectiveDate: "bad-date",
      timezone: "bad-zone",
      weeklyAvailability: weeklyAvailability({ monday: [{ start: "17:00", end: "09:00" }] })
    })
  });
  assert.equal(invalidShape.response.status, 400);
  assert.match(invalidShape.json.errors.join(" "), /cross-midnight/);

  const created = await request("/api/provider-availability", {
    method: "POST",
    cookie: adminCookie,
    body: availabilityPayload()
  });
  assert.equal(created.response.status, 201);
  assert.equal((await request("/api/provider-availability", {
    method: "POST", cookie: adminCookie, body: availabilityPayload()
  })).response.status, 409);
  assert.equal((await request("/api/provider-availability/user-rbt", {
    method: "PUT", cookie: adminCookie, body: availabilityPayload()
  })).response.status, 400);
  assert.equal((await request("/api/provider-availability", {
    method: "POST", cookie: rbtCookie, body: availabilityPayload({ providerUserId: "user-bcba" })
  })).response.status, 403);
  assert.equal((await request("/api/provider-availability/user-rbt/deactivate", {
    method: "POST", cookie: readOnlyCookie, body: { expectedVersion: 1 }
  })).response.status, 403);

  const persisted = await readDb();
  persisted.users.find((user) => user.id === "user-bcba").active = false;
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  const inactiveProvider = await request("/api/provider-availability", {
    method: "POST",
    cookie: adminCookie,
    body: availabilityPayload({ providerUserId: "user-bcba" })
  });
  assert.equal(inactiveProvider.response.status, 400);
});

test("availability is excluded from clinical bootstrap but preserved by backup and restore", async () => {
  await resetDb();
  const adminCookie = await login();
  const created = await request("/api/provider-availability", {
    method: "POST",
    cookie: adminCookie,
    body: availabilityPayload()
  });
  assert.equal(created.response.status, 201);

  const bootstrap = await request("/api/data", { cookie: adminCookie });
  assert.equal("providerAvailabilityProfiles" in bootstrap.json, false);
  const backup = await request("/api/backup", { cookie: adminCookie });
  assert.equal(backup.response.status, 200);
  assert.deepEqual(backup.json.data.providerAvailabilityProfiles, [created.json]);

  const persisted = await readDb();
  persisted.providerAvailabilityProfiles = [];
  await writeFile(dbPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  const restored = await request("/api/backup/restore", {
    method: "POST",
    cookie: adminCookie,
    body: backup.json
  });
  assert.equal(restored.response.status, 200);
  assert.deepEqual((await readDb()).providerAvailabilityProfiles, [created.json]);

  const legacyBackup = structuredClone(backup.json);
  delete legacyBackup.data.providerAvailabilityProfiles;
  const legacyRestore = await request("/api/backup/restore", {
    method: "POST",
    cookie: adminCookie,
    body: legacyBackup
  });
  assert.equal(legacyRestore.response.status, 200);
  assert.deepEqual((await readDb()).providerAvailabilityProfiles, []);
});
