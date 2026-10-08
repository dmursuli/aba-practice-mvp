import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { mutateJsonStateAtomically } from "./json-state-store.mjs";

const emptyStore = () => ({ drafts: [] });

async function ensureJsonStore(path) {
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(emptyStore(), null, 2)}\n`, "utf8");
  }
}

export async function mutateJsonSessionDrafts(path, mutator) {
  await ensureJsonStore(path);
  let result;
  await mutateJsonStateAtomically(path, async (store) => {
    store.drafts = Array.isArray(store.drafts) ? store.drafts : [];
    result = await mutator(store);
    return store;
  });
  return result;
}

export async function readJsonSessionDrafts(path) {
  await ensureJsonStore(path);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  return Array.isArray(parsed.drafts) ? parsed.drafts : [];
}

async function withPostgresClient(config, callback) {
  const { Pool } = await import("pg");
  const ssl = config.ssl ? { rejectUnauthorized: config.sslRejectUnauthorized, ...(config.caCert ? { ca:config.caCert } : {}) } : undefined;
  const pool = new Pool(config.databaseUrl ? { connectionString:config.databaseUrl, ssl } : {
    host:config.host, port:Number(config.port || 5432), database:config.database,
    user:config.user, password:config.password, ssl
  });
  const client = await pool.connect();
  try {
    await ensurePostgresSessionDraftSchema(client);
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function ensurePostgresSessionDraftSchema(client) {
  await client.query(`
    create table if not exists session_drafts (
      id text primary key,
      client_id text not null,
      owner_user_id text not null,
      service_type text not null,
      clinical_date text not null default '',
      start_time text not null default '',
      status text not null,
      revision integer not null,
      payload jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      last_saved_at timestamptz not null,
      completed_session_id text
    )
  `);
  await client.query("create index if not exists session_drafts_owner_status_idx on session_drafts (owner_user_id, status, updated_at desc)");
}

const fromRow = row => ({
  id: row.id,
  clientId: row.client_id,
  ownerUserId: row.owner_user_id,
  serviceType: row.service_type,
  clinicalDate: row.clinical_date,
  startTime: row.start_time,
  status: row.status,
  revision: Number(row.revision),
  payload: row.payload || {},
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  lastSavedAt: new Date(row.last_saved_at).toISOString(),
  completedSessionId: row.completed_session_id || ""
});

export async function listPostgresSessionDrafts(config, ownerUserId, clientId = "") {
  return withPostgresClient(config, async client => {
    const result = await client.query(
      `select * from session_drafts where owner_user_id = $1 and status = 'in_progress' and ($2 = '' or client_id = $2) order by updated_at desc`,
      [ownerUserId, clientId]
    );
    return result.rows.map(fromRow);
  });
}

export async function getPostgresSessionDraft(config, id) {
  return withPostgresClient(config, async client => {
    const result = await client.query("select * from session_drafts where id = $1", [id]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  });
}

export async function createPostgresSessionDraft(config, draft) {
  return withPostgresClient(config, async client => {
    const result = await client.query(`
      insert into session_drafts (id, client_id, owner_user_id, service_type, clinical_date, start_time, status, revision, payload, created_at, updated_at, last_saved_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10,$10) returning *
    `, [draft.id,draft.clientId,draft.ownerUserId,draft.serviceType,draft.clinicalDate,draft.startTime,draft.status,draft.revision,JSON.stringify(draft.payload),draft.createdAt]);
    return fromRow(result.rows[0]);
  });
}

export async function updatePostgresSessionDraft(config, id, ownerUserId, expectedRevision, values) {
  return withPostgresClient(config, async client => {
    const result = await client.query(`
      update session_drafts set payload=$1::jsonb, clinical_date=$2, start_time=$3, revision=revision+1, updated_at=$4, last_saved_at=$4
      where id=$5 and owner_user_id=$6 and status='in_progress' and revision=$7 returning *
    `,[JSON.stringify(values.payload),values.clinicalDate,values.startTime,values.updatedAt,id,ownerUserId,expectedRevision]);
    if (result.rows[0]) return { draft: fromRow(result.rows[0]) };
    const current = await client.query("select * from session_drafts where id=$1",[id]);
    return { draft: current.rows[0] ? fromRow(current.rows[0]) : null, conflict: Boolean(current.rows[0]) };
  });
}

export async function completePostgresSessionDraft(config, { id, ownerUserId, expectedRevision, buildSession }) {
  return withPostgresClient(config, async client => {
    await client.query("begin");
    try {
      const draftResult = await client.query("select * from session_drafts where id=$1 for update",[id]);
      const draft = draftResult.rows[0] ? fromRow(draftResult.rows[0]) : null;
      if (!draft) { await client.query("rollback"); return { missing: true }; }
      if (draft.ownerUserId !== ownerUserId) { await client.query("rollback"); return { forbidden: true }; }
      if (draft.completedSessionId) { await client.query("commit"); return { draft, completedSessionId:draft.completedSessionId, idempotent:true }; }
      if (draft.revision !== expectedRevision) { await client.query("rollback"); return { draft, conflict:true }; }
      const stateResult = await client.query("select data from app_state where id='main' for update");
      const db = stateResult.rows[0]?.data || {};
      const built = await buildSession(draft, db);
      if (built.errors?.length) { await client.query("rollback"); return built; }
      db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
      const existing = db.sessions.find(item => item.sourceDraftId === id);
      const session = existing || built.session;
      if (!existing) db.sessions.unshift(session);
      await client.query("update app_state set data=$1::jsonb, updated_at=now() where id='main'",[JSON.stringify(db)]);
      const now = new Date().toISOString();
      const updated = await client.query("update session_drafts set status='completed', completed_session_id=$1, updated_at=$2, last_saved_at=$2, revision=revision+1 where id=$3 returning *",[session.id,now,id]);
      await client.query("commit");
      return { draft:fromRow(updated.rows[0]), session, db };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
