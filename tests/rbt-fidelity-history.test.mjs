import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-rbt-history-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";
await writeFile(process.env.DB_PATH, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, "utf8");

const { createAppServer, resetRuntimeState } = await import("../server.js");
let server;
let baseUrl;
let adminCookie;
let bcbaCookie;
let rbtCookie;
let defaultRbt;
let secondRbt;
let emptyRbt;
let clientA;
let clientB;
let clientC;

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || ""
  };
}

async function login(username, password) {
  const result = await request("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(result.status, 200);
  return result.cookie;
}

async function createUser(username, name) {
  const result = await request("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username, name, email: `${username}@example.com`, role: "rbt", password: "testing123" }
  });
  assert.equal(result.status, 201);
  return result.json;
}

async function createClient(name) {
  const result = await request("/api/clients", { method: "POST", cookie: adminCookie, body: { name } });
  assert.equal(result.status, 201);
  return result.json;
}

async function assign(clientId, userId) {
  const result = await request(`/api/clients/${clientId}/assignments`, {
    method: "POST",
    cookie: adminCookie,
    body: { userId }
  });
  assert.equal(result.status, 201);
}

async function observe(clientId, rbtUserId, observationDate, responses) {
  const result = await request(`/api/clients/${clientId}/rbt-fidelity-observations`, {
    method: "POST",
    cookie: bcbaCookie,
    body: { rbtUserId, observationDate, responses, relatedSessionId: `${clientId}-${observationDate}` }
  });
  assert.equal(result.status, 201);
}

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminCookie = await login("admin", "admin123");
  bcbaCookie = await login("bcba", "bcba123");
  rbtCookie = await login("rbt", "rbt123");
  const users = await request("/api/users", { cookie: adminCookie });
  defaultRbt = users.json.users.find((user) => user.role === "rbt");
  secondRbt = await createUser("rbt-two", "Second RBT");
  emptyRbt = await createUser("rbt-empty", "Empty RBT");
  clientA = await createClient("History Client A");
  clientB = await createClient("History Client B");
  clientC = await createClient("History Client C");
  await assign(clientA.id, defaultRbt.id);
  await assign(clientB.id, defaultRbt.id);
  await assign(clientC.id, secondRbt.id);
  await observe(clientB.id, defaultRbt.id, "2026-09-08", [
    { areaId: "a", label: "A", response: "yes" },
    { areaId: "b", label: "B", response: "no" }
  ]);
  await observe(clientA.id, defaultRbt.id, "2026-09-01", [
    { areaId: "a", label: "A", response: "yes" }
  ]);
  await observe(clientC.id, secondRbt.id, "2026-09-03", [
    { areaId: "a", label: "A", response: "no" }
  ]);
});

after(async () => {
  resetRuntimeState();
  await new Promise((resolve) => server.close(resolve));
});

test("one RBT history aggregates multiple clients in date order with bounded fidelity values", async () => {
  const result = await request(`/api/rbt-fidelity-history?rbtUserId=${defaultRbt.id}`, { cookie: adminCookie });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.observations.map((item) => item.clientId), [clientA.id, clientB.id]);
  assert.deepEqual(result.json.observations.map((item) => item.observationDate), ["2026-09-01", "2026-09-08"]);
  assert.deepEqual(result.json.observations.map((item) => item.fidelityPercent), [100, 50]);
  assert.ok(result.json.observations.every((item) => item.fidelityPercent >= 0 && item.fidelityPercent <= 100));
});

test("different RBT histories remain separate and an RBT with no observations has an empty history", async () => {
  const second = await request(`/api/rbt-fidelity-history?rbtUserId=${secondRbt.id}`, { cookie: adminCookie });
  assert.equal(second.status, 200);
  assert.deepEqual(second.json.observations.map((item) => item.clientId), [clientC.id]);
  assert.ok(second.json.observations.every((item) => item.rbtUserId === secondRbt.id));
  const empty = await request(`/api/rbt-fidelity-history?rbtUserId=${emptyRbt.id}`, { cookie: adminCookie });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.observations, []);
});

test("Admin and BCBA can retrieve fidelity history while RBT cannot", async () => {
  const admin = await request(`/api/rbt-fidelity-history?rbtUserId=${defaultRbt.id}`, { cookie: adminCookie });
  const bcba = await request(`/api/rbt-fidelity-history?rbtUserId=${defaultRbt.id}`, { cookie: bcbaCookie });
  const rbt = await request(`/api/rbt-fidelity-history?rbtUserId=${defaultRbt.id}`, { cookie: rbtCookie });
  assert.equal(admin.status, 200);
  assert.equal(bcba.status, 200);
  assert.equal(rbt.status, 403);
});

test("the Users fidelity interface is available to BCBA but excluded from RBT views", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /bcba:\s*\[[^\]]*"users"/);
  assert.doesNotMatch(source, /rbt:\s*\[[^\]]*"users"/);
});
