import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateRbtFidelity, setRbtFidelityResponse } from "../public/rbt-fidelity.js";

const eightAreas = Array.from({ length: 8 }, (_, index) => ({ id: `area-${index + 1}`, label: `Area ${index + 1}` }));

test("Yes selection is recorded", () => {
  assert.deepEqual(setRbtFidelityResponse({}, "area-1", "yes"), { "area-1": "yes" });
});

test("No selection is recorded", () => {
  assert.deepEqual(setRbtFidelityResponse({}, "area-1", "no"), { "area-1": "no" });
});

test("a Yes response can be changed to No", () => {
  const yes = setRbtFidelityResponse({}, "area-1", "yes");
  assert.deepEqual(setRbtFidelityResponse(yes, "area-1", "no"), { "area-1": "no" });
});

test("unanswered items are excluded from the fidelity denominator", () => {
  const result = calculateRbtFidelity(eightAreas, {
    "area-1": "yes",
    "area-2": "yes",
    "area-3": "yes",
    "area-4": "no"
  });
  assert.equal(result.total, 4);
  assert.equal(result.percent, 75);
});

test("eight Yes responses calculate 100 percent", () => {
  const responses = Object.fromEntries(eightAreas.map((area) => [area.id, "yes"]));
  assert.equal(calculateRbtFidelity(eightAreas, responses).percent, 100);
});

test("six Yes and two No responses calculate 75 percent", () => {
  const responses = Object.fromEntries(eightAreas.map((area, index) => [area.id, index < 6 ? "yes" : "no"]));
  const result = calculateRbtFidelity(eightAreas, responses);
  assert.equal(result.yesCount, 6);
  assert.equal(result.noCount, 2);
  assert.equal(result.percent, 75);
});

test("no answered items produces an unscored result", () => {
  assert.equal(calculateRbtFidelity(eightAreas, {}).percent, null);
});

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "aba-rbt-fidelity-test-")), "db.json");
process.env.MFA_ENABLED = "false";
process.env.ABA_DISABLE_AUTOSTART = "1";
await writeFile(process.env.DB_PATH, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, "utf8");

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

test("fidelity observations reload with the correct RBT and preserve prior observations", async () => {
  const adminCookie = await login("admin", "admin123");
  const createdClient = await request("/api/clients", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "Fidelity Client" }
  });
  assert.equal(createdClient.status, 201);
  const users = await request("/api/users", { cookie: adminCookie });
  const rbt = users.json.users.find((user) => user.role === "rbt");
  const bcba = users.json.users.find((user) => user.role === "bcba");
  assert.ok(rbt?.id);
  assert.ok(bcba?.id);
  const assignment = await request(`/api/clients/${createdClient.json.id}/assignments`, {
    method: "POST",
    cookie: adminCookie,
    body: { userId: rbt.id }
  });
  assert.equal(assignment.status, 201);

  const bcbaCookie = await login("bcba", "bcba123");
  const firstResponses = eightAreas.map((area, index) => ({
    areaId: area.id,
    label: area.label,
    response: index < 6 ? "yes" : "no"
  }));
  const first = await request(`/api/clients/${createdClient.json.id}/rbt-fidelity-observations`, {
    method: "POST",
    cookie: bcbaCookie,
    body: {
      rbtUserId: rbt.id,
      observationDate: "2026-09-10",
      responses: firstResponses,
      fidelityPercent: 100,
      writtenFeedback: "First observation",
      relatedSessionId: "97155-session-1"
    }
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.observation.fidelityPercent, 75);
  assert.equal(first.json.observation.rbtUserId, rbt.id);
  assert.equal(first.json.observation.supervisingUserId, bcba.id);
  assert.equal(first.json.observation.clientId, createdClient.json.id);

  const second = await request(`/api/clients/${createdClient.json.id}/rbt-fidelity-observations`, {
    method: "POST",
    cookie: bcbaCookie,
    body: {
      rbtUserId: rbt.id,
      observationDate: "2026-09-11",
      responses: [{ areaId: "area-1", label: "Area 1", response: "yes" }],
      writtenFeedback: "Second observation",
      relatedSessionId: "97155-session-2"
    }
  });
  assert.equal(second.status, 201);
  assert.notEqual(second.json.observation.id, first.json.observation.id);

  const reloaded = await request("/api/data", { cookie: bcbaCookie });
  const client = reloaded.json.clients.find((item) => item.id === createdClient.json.id);
  assert.equal(client.rbtFidelityObservations.length, 2);
  assert.equal(client.rbtFidelityObservations[0].id, first.json.observation.id);
  assert.equal(client.rbtFidelityObservations[0].fidelityPercent, 75);
  assert.equal(client.rbtFidelityObservations[0].relatedSessionId, "97155-session-1");
  assert.equal(client.rbtFidelityObservations[1].relatedSessionId, "97155-session-2");
});
