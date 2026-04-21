let pool;

export async function readDbFromPostgres(config) {
  const client = await getPool(config).connect();
  try {
    await ensureSchema(client);
    const result = await client.query("select data from app_state where id = $1", ["main"]);
    if (result.rows[0]?.data) return result.rows[0].data;
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
}

async function writeDbWithClient(client, db) {
  await client.query(
    `
      insert into app_state (id, data, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    ["main", JSON.stringify(db)]
  );
}

function emptyState() {
  return {
    clients: [],
    sessions: [],
    auditLog: [],
    users: []
  };
}
