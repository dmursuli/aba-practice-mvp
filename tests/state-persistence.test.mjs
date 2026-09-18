import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutateJsonStateAtomically, writeJsonStateAtomically } from "../lib/json-state-store.mjs";
import { closePostgresPool, mutateDbInPostgres, writeDbToPostgres } from "../lib/postgres-store.mjs";

function fakePostgres(initialState) {
  const queries = [];
  let released = false;
  let state = structuredClone(initialState);
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
      queries.push(normalized);
      if (normalized.startsWith("select data")) return { rows: [{ data: structuredClone(state) }] };
      if (normalized.includes("insert into app_state")) {
        state = JSON.parse(params[1]);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { released = true; }
  };
  class FakePool {
    connect() { return Promise.resolve(client); }
    end() { return Promise.resolve(); }
  }
  return {
    config: { Pool: FakePool },
    queries,
    get state() { return state; },
    get released() { return released; }
  };
}

test.afterEach(async () => {
  await closePostgresPool();
});

test("PostgreSQL transaction state mutator locks and commits one state write", async () => {
  const fake = fakePostgres({ clients: [], appointments: [], recurringAppointmentSeries: [] });
  const result = await mutateDbInPostgres(fake.config, (state) => {
    state.recurringAppointmentSeries.push({ id: "series-1" });
  });
  assert.deepEqual(result.recurringAppointmentSeries, [{ id: "series-1" }]);
  assert.deepEqual(fake.state.recurringAppointmentSeries, [{ id: "series-1" }]);
  assert.ok(fake.queries.includes("begin"));
  assert.ok(fake.queries.some((sql) => sql === "select data from app_state where id = $1 for update"));
  assert.equal(fake.queries.filter((sql) => sql.includes("insert into app_state")).length, 1);
  assert.ok(fake.queries.includes("commit"));
  assert.equal(fake.queries.includes("rollback"), false);
  assert.equal(fake.released, true);
});

test("PostgreSQL transaction state preserves provider availability profiles", async () => {
  const initial = { clients: [], providerAvailabilityProfiles: [] };
  const fake = fakePostgres(initial);
  await mutateDbInPostgres(fake.config, (state) => {
    state.providerAvailabilityProfiles.push({
      id: "availability-1",
      providerUserId: "user-rbt",
      effectiveDate: "2026-09-21",
      timezone: "America/New_York",
      weeklyAvailability: { monday: [{ start: "09:00", end: "17:00" }] },
      active: true,
      version: 1
    });
  });
  assert.equal(fake.state.providerAvailabilityProfiles.length, 1);
  assert.equal(fake.state.providerAvailabilityProfiles[0].providerUserId, "user-rbt");
});

test("PostgreSQL transaction state mutator rolls back a complete recurring-series operation on error", async () => {
  const initial = { clients: [], recurringAppointmentSeries: [], appointments: [], auditLog: [] };
  const fake = fakePostgres(initial);
  await assert.rejects(
    mutateDbInPostgres(fake.config, (state) => {
      state.recurringAppointmentSeries.push({ id: "must-not-commit" });
      state.appointments.push({ id: "occurrence-must-not-commit" });
      state.auditLog.push({ id: "audit-must-not-commit" });
      throw new Error("mutation failed");
    }),
    /mutation failed/
  );
  assert.deepEqual(fake.state, initial);
  assert.equal(fake.queries.filter((sql) => sql.includes("insert into app_state")).length, 0);
  assert.ok(fake.queries.includes("rollback"));
  assert.equal(fake.queries.includes("commit"), false);
  assert.equal(fake.released, true);
});

test("existing PostgreSQL write path remains a non-transactional single state write", async () => {
  const fake = fakePostgres({ clients: [] });
  await writeDbToPostgres(fake.config, { clients: [{ id: "client-1" }] });
  assert.deepEqual(fake.state.clients, [{ id: "client-1" }]);
  assert.equal(fake.queries.includes("begin"), false);
  assert.equal(fake.queries.filter((sql) => sql.includes("insert into app_state")).length, 1);
});

test("PostgreSQL assignment persistence uses an additive normalized table with a duplicate guard", async () => {
  const fake = fakePostgres({ clients: [{ id: "client-1" }], users: [{ id: "user-1" }] });
  await writeDbToPostgres(fake.config, {
    clients: [{ id: "client-1" }],
    users: [{ id: "user-1" }],
    clientUserAssignments: [{
      id: "assignment-1",
      clientId: "client-1",
      userId: "user-1",
      createdAt: "2026-09-10T12:00:00.000Z",
      createdByUserId: "admin-1"
    }]
  });
  assert.ok(fake.queries.some((sql) => (
    sql.includes("create table if not exists client_user_assignments")
    && sql.includes("unique (client_id, user_id)")
  )));
  assert.ok(fake.queries.some((sql) => sql.includes("insert into client_user_assignments")));
  assert.ok(fake.queries.some((sql) => sql.startsWith("delete from client_user_assignments")));
  assert.equal("clientUserAssignments" in fake.state, false);
});

test("local JSON transaction mutator commits atomically and preserves serialized writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aba-json-state-"));
  const path = join(directory, "db.json");
  await writeFile(path, JSON.stringify({ counter: 0, values: [] }), "utf8");
  await Promise.all([
    mutateJsonStateAtomically(path, async (state) => {
      state.counter += 1;
      state.values.push("first");
    }),
    mutateJsonStateAtomically(path, async (state) => {
      state.counter += 1;
      state.values.push("second");
    })
  ]);
  const persisted = JSON.parse(await readFile(path, "utf8"));
  assert.equal(persisted.counter, 2);
  assert.deepEqual(persisted.values, ["first", "second"]);
});

test("local JSON transaction mutator leaves no partial recurring-series operation on error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aba-json-rollback-"));
  const path = join(directory, "db.json");
  const initial = { stable: true, recurringAppointmentSeries: [], appointments: [], auditLog: [] };
  await writeJsonStateAtomically(path, initial);
  await assert.rejects(
    mutateJsonStateAtomically(path, (state) => {
      state.stable = false;
      state.recurringAppointmentSeries.push({ id: "must-not-commit" });
      state.appointments.push({ id: "occurrence-must-not-commit" });
      state.auditLog.push({ id: "audit-must-not-commit" });
      throw new Error("stop");
    }),
    /stop/
  );
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), initial);
});
