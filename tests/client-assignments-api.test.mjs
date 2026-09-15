import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-assignments-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";

const dbPath = process.env.DB_PATH;
await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, "utf8");

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

test("client assignments enforce RBT list, direct-read, and mutation access without changing clients or users", async () => {
  const adminCookie = await login("admin", "admin123");
  const clientA = await request("/api/clients", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "Assignment Client A" }
  });
  const clientB = await request("/api/clients", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "Assignment Client B" }
  });
  assert.equal(clientA.status, 201);
  assert.equal(clientB.status, 201);

  const seeded = JSON.parse(await readFile(dbPath, "utf8"));
  seeded.sessions.push({
    id: "protected-client-b-session",
    clientId: clientB.json.id,
    agency: "Triumph ABA",
    soapNote: "Protected note",
    finalized: false,
    programs: [],
    behaviors: [],
    parentGoals: []
  });
  await writeFile(dbPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  const usersBefore = await request("/api/users", { cookie: adminCookie });
  const rbt = usersBefore.json.users.find((user) => user.role === "rbt");
  assert.ok(rbt?.id);

  const adminData = await request("/api/data", { cookie: adminCookie });
  assert.deepEqual(new Set(adminData.json.clients.map((client) => client.id)), new Set([clientA.json.id, clientB.json.id]));

  const rbtCookie = await login("rbt", "rbt123");
  const unassignedData = await request("/api/data", { cookie: rbtCookie });
  assert.deepEqual(unassignedData.json.clients, []);

  const assigned = await request(`/api/clients/${clientA.json.id}/assignments`, {
    method: "POST",
    cookie: adminCookie,
    body: { userId: rbt.id }
  });
  assert.equal(assigned.status, 201);

  const duplicate = await request(`/api/clients/${clientA.json.id}/assignments`, {
    method: "POST",
    cookie: adminCookie,
    body: { userId: rbt.id }
  });
  assert.equal(duplicate.status, 409);

  const assignedData = await request("/api/data", { cookie: rbtCookie });
  assert.deepEqual(assignedData.json.clients.map((client) => client.id), [clientA.json.id]);
  assert.equal(assignedData.json.clients.some((client) => client.id === clientB.json.id), false);

  const allowedDirectRead = await request(`/api/clients/${clientA.json.id}/sessions`, { cookie: rbtCookie });
  assert.equal(allowedDirectRead.status, 200);
  const blockedDirectRead = await request(`/api/clients/${clientB.json.id}/sessions`, { cookie: rbtCookie });
  assert.equal(blockedDirectRead.status, 403);
  const blockedMutation = await request("/api/sessions", {
    method: "POST",
    cookie: rbtCookie,
    body: { clientId: clientB.json.id }
  });
  assert.equal(blockedMutation.status, 403);
  const blockedDirectMutation = await request("/api/sessions/protected-client-b-session/note", {
    method: "PUT",
    cookie: rbtCookie,
    body: { soapNote: "Tampered note" }
  });
  assert.equal(blockedDirectMutation.status, 403);

  const removed = await request(`/api/clients/${clientA.json.id}/assignments/${encodeURIComponent(rbt.id)}`, {
    method: "DELETE",
    cookie: adminCookie
  });
  assert.equal(removed.status, 200);
  const removedData = await request("/api/data", { cookie: rbtCookie });
  assert.deepEqual(removedData.json.clients, []);
  const revokedDirectRead = await request(`/api/clients/${clientA.json.id}/sessions`, { cookie: rbtCookie });
  assert.equal(revokedDirectRead.status, 403);

  const persisted = JSON.parse(await readFile(dbPath, "utf8"));
  assert.equal(persisted.clients.length, 2);
  assert.equal(persisted.users.length, usersBefore.json.users.length);
  assert.deepEqual(persisted.clientUserAssignments, []);
  assert.equal(persisted.sessions.find((session) => session.id === "protected-client-b-session").soapNote, "Protected note");
});
