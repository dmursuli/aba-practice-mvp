import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICE_ZONE_VALUES, sanitizeProviderZoneInput } from "../lib/service-zones.mjs";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-provider-zones-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";
const dbPath = process.env.DB_PATH;
const baseDb = { clients: [], sessions: [], appointments: [], recurringAppointmentSeries: [], providerAvailabilityProfiles: [], auditLog: [], users: [], clientUserAssignments: [] };
await writeFile(dbPath, `${JSON.stringify(baseDb, null, 2)}\n`);
const { createAppServer, resetRuntimeState } = await import("../server.js");
let server; let baseUrl;
before(async () => { server = createAppServer(); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
after(async () => { resetRuntimeState(); await new Promise((resolve) => server.close(resolve)); });
async function reset() { resetRuntimeState(); await writeFile(dbPath, `${JSON.stringify(structuredClone(baseDb), null, 2)}\n`); }
async function db() { return JSON.parse(await readFile(dbPath, "utf8")); }
async function request(path, { method = "GET", body, cookie } = {}) { const headers = {}; if (body !== undefined) headers["content-type"] = "application/json"; if (cookie) headers.cookie = cookie; const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); return { response, json: text ? JSON.parse(text) : {}, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie }; }
async function login(username = "admin", password = "admin123") { const result = await request("/api/auth/login", { method: "POST", body: { username, password } }); assert.equal(result.response.status, 200); return result.cookie; }
const payload = (overrides = {}) => ({ providerUserId: "user-rbt", primaryZone: "West Kendall", acceptableZones: ["Doral", "Kendall"], ...overrides });

test("zone model reuses canonical service zones, normalizes duplicates, and rejects invalid or primary duplication", () => {
  assert.ok(SERVICE_ZONE_VALUES.includes("West Kendall"));
  assert.deepEqual(sanitizeProviderZoneInput(payload({ acceptableZones: ["Kendall", "Doral", "Kendall"] })).profile.acceptableZones, ["Kendall", "Doral"]);
  assert.match(sanitizeProviderZoneInput(payload({ primaryZone: "Unknown" })).errors.join(" "), /approved primary zone/);
  assert.match(sanitizeProviderZoneInput(payload({ acceptableZones: ["West Kendall"] })).errors.join(" "), /cannot also/);
});

test("Admin and BCBA manage profiles organization-wide while RBT, read-only, and anonymous are denied", async () => {
  await reset();
  const admin = await login();
  let state = await db();
  state.users.find((user) => user.id === "user-admin").agency = "One";
  state.users.find((user) => user.id === "user-rbt").agency = "Two";
  await writeFile(dbPath, `${JSON.stringify(state, null, 2)}\n`);
  const created = await request("/api/provider-zones", { method: "POST", cookie: admin, body: payload() });
  assert.equal(created.response.status, 201);
  assert.equal(created.json.version, 1);
  assert.equal(created.json.active, true);
  const bcba = await login("bcba", "bcba123");
  assert.equal((await request("/api/provider-zones/user-rbt", { cookie: bcba })).response.status, 200);
  const updated = await request("/api/provider-zones/user-rbt", { method: "PUT", cookie: bcba, body: { primaryZone: "Doral", acceptableZones: ["Kendall"], expectedVersion: 1 } });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.version, 2);
  assert.equal((await request("/api/provider-zones", { cookie: await login("rbt", "rbt123") })).response.status, 403);
  assert.equal((await request("/api/provider-zones", { cookie: await login("readonly", "readonly123") })).response.status, 403);
  assert.equal((await request("/api/provider-zones")).response.status, 401);
});

test("eligibility, uniqueness, validation, versions, deactivate, and reactivate are enforced", async () => {
  await reset(); const admin = await login();
  assert.equal((await request("/api/provider-zones", { method: "POST", cookie: admin, body: payload({ providerUserId: "user-admin" }) })).response.status, 400);
  const created = await request("/api/provider-zones", { method: "POST", cookie: admin, body: payload() });
  assert.equal(created.response.status, 201);
  const bcbaProfile = await request("/api/provider-zones", { method: "POST", cookie: admin, body: payload({ providerUserId: "user-bcba", primaryZone: "Doral", acceptableZones: [] }) });
  assert.equal(bcbaProfile.response.status, 201);
  assert.equal((await request("/api/provider-zones", { method: "POST", cookie: admin, body: payload() })).response.status, 409);
  assert.equal((await request("/api/provider-zones/user-rbt", { method: "PUT", cookie: admin, body: { ...payload(), expectedVersion: 99 } })).response.status, 409);
  const off = await request("/api/provider-zones/user-rbt/deactivate", { method: "POST", cookie: admin, body: { expectedVersion: 1 } });
  assert.equal(off.json.active, false); assert.equal(off.json.version, 2);
  assert.equal((await db()).providerZoneProfiles.length, 2);
  const on = await request("/api/provider-zones/user-rbt", { method: "PUT", cookie: admin, body: { ...payload(), expectedVersion: 2 } });
  assert.equal(on.json.active, true); assert.equal(on.json.version, 3);
});

test("inactive providers are rejected and canonical zones are returned to the UI", async () => {
  await reset(); const admin = await login(); const state = await db();
  state.users.find((user) => user.id === "user-rbt").active = false;
  await writeFile(dbPath, `${JSON.stringify(state, null, 2)}\n`);
  const list = await request("/api/provider-zones", { cookie: admin });
  assert.deepEqual(list.json.zones, SERVICE_ZONE_VALUES);
  assert.ok(!list.json.providers.some((provider) => provider.id === "user-rbt"));
  assert.equal((await request("/api/provider-zones", { method: "POST", cookie: admin, body: payload() })).response.status, 400);
});

test("backup and restore preserve zone profiles while legacy backups default safely", async () => {
  await reset(); const admin = await login();
  const created = await request("/api/provider-zones", { method: "POST", cookie: admin, body: payload() });
  const backup = await request("/api/backup", { cookie: admin });
  assert.deepEqual(backup.json.data.providerZoneProfiles, [created.json]);
  assert.equal("providerZoneProfiles" in (await request("/api/data", { cookie: admin })).json, false);
  const legacy = structuredClone(backup.json); delete legacy.data.providerZoneProfiles;
  assert.equal((await request("/api/backup/restore", { method: "POST", cookie: admin, body: legacy })).response.status, 200);
  assert.deepEqual((await db()).providerZoneProfiles, []);
  assert.equal((await request("/api/backup/restore", { method: "POST", cookie: admin, body: backup.json })).response.status, 200);
  assert.deepEqual((await db()).providerZoneProfiles, [created.json]);
});
