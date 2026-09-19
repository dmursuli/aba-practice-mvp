let pool;

export async function readDbFromPostgres(config) {
  const client = await getPool(config).connect();
  try {
    await ensureSchema(client);
    const result = await client.query("select data from app_state where id = $1", ["main"]);
    if (result.rows[0]?.data) {
      const db = result.rows[0].data;
      db.clientUserAssignments = await readAssignmentsWithClient(client, db.clientUserAssignments);
      return db;
    }
    const empty = emptyState();
    await writeDbWithClient(client, empty);
    return empty;
  } finally {
    client.release();
  }
}

export async function writeDbToPostgres(config, db) {
  const client = await getPool(config).connect();
  try {
    await ensureSchema(client);
    await writeDbWithClient(client, db);
  } finally {
    client.release();
  }
}

export async function mutateDbInPostgres(config, mutator) {
  if (typeof mutator !== "function") throw new TypeError("mutator must be a function");
  const client = await getPool(config).connect();
  let transactionStarted = false;
  try {
    await ensureSchema(client);
    await client.query("begin");
    transactionStarted = true;
    const result = await client.query("select data from app_state where id = $1 for update", ["main"]);
    const current = result.rows[0]?.data || emptyState();
    current.clientUserAssignments = await readAssignmentsWithClient(client, current.clientUserAssignments);
    const mutated = await mutator(current);
    const next = mutated === undefined ? current : mutated;
    await writeDbWithClient(client, next);
    await client.query("commit");
    transactionStarted = false;
    return next;
  } catch (error) {
    if (transactionStarted) await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

function getPool(config) {
  if (pool) return pool;
  pool = new config.Pool(poolConfig(config));
  return pool;
}

function poolConfig(config) {
  if (config.databaseUrl) {
    return {
      connectionString: config.databaseUrl,
      ssl: sslConfig(config)
    };
  }
  return {
    host: config.host,
    port: Number(config.port || 5432),
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: sslConfig(config)
  };
}

function sslConfig(config) {
  if (!config.ssl) return undefined;
  const ssl = {
    rejectUnauthorized: config.sslRejectUnauthorized
  };
  if (config.caCert) ssl.ca = config.caCert;
  return ssl;
}

async function ensureSchema(client) {
  await client.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  await client.query(`
    create table if not exists client_user_assignments (
      id text primary key,
      client_id text not null,
      user_id text not null,
      created_at timestamptz not null default now(),
      created_by_user_id text,
      unique (client_id, user_id)
    )
  `);
}

async function writeDbWithClient(client, db) {
  const stateDocument = { ...db };
  delete stateDocument.clientUserAssignments;
  await client.query(
    `
      insert into app_state (id, data, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    ["main", JSON.stringify(stateDocument)]
  );
  await synchronizeAssignments(client, db.clientUserAssignments || []);
}

async function readAssignmentsWithClient(client, legacyAssignments = []) {
  const result = await client.query(`
    select id, client_id, user_id, created_at, created_by_user_id
    from client_user_assignments
    order by created_at, id
  `);
  if (!result.rows.length && Array.isArray(legacyAssignments) && legacyAssignments.length) {
    await synchronizeAssignments(client, legacyAssignments);
    return legacyAssignments;
  }
  return result.rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
    createdByUserId: row.created_by_user_id || ""
  }));
}

async function synchronizeAssignments(client, assignments) {
  const normalized = Array.isArray(assignments) ? assignments : [];
  for (const assignment of normalized) {
    await client.query(
      `
        insert into client_user_assignments (id, client_id, user_id, created_at, created_by_user_id)
        values ($1, $2, $3, $4, $5)
        on conflict (client_id, user_id)
        do update set id = excluded.id,
                      created_at = excluded.created_at,
                      created_by_user_id = excluded.created_by_user_id
      `,
      [assignment.id, assignment.clientId, assignment.userId, assignment.createdAt, assignment.createdByUserId || null]
    );
  }
  await client.query(
    `delete from client_user_assignments where not (client_id || ':' || user_id = any($1::text[]))`,
    [normalized.map((assignment) => `${assignment.clientId}:${assignment.userId}`)]
  );
}

function emptyState() {
  return {
    clients: [],
    sessions: [],
    appointments: [],
    recurringAppointmentSeries: [],
    providerAvailabilityProfiles: [],
    providerZoneProfiles: [],
    auditLog: [],
    users: [],
    clientUserAssignments: []
  };
}
