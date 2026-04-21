import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { writeDbToPostgres, closePostgresPool } from "../lib/postgres-store.mjs";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const source = process.env.JSON_DB_PATH || join(root, "data", "db.json");
const raw = await readFile(source, "utf8");
const db = JSON.parse(raw);

await writeDbToPostgres(postgresConfig(), db);
await closePostgresPool();

console.log(`Migrated ${source} to PostgreSQL app_state.`);

function postgresConfig() {
  const sslEnabled = process.env.DB_SSL === "true" || (process.env.NODE_ENV === "production" && process.env.DB_SSL !== "false");
  return {
    Pool,
    databaseUrl: process.env.DATABASE_URL || "",
    host: process.env.DB_HOST || "",
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || "postgres",
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    ssl: sslEnabled,
    sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    caCert: process.env.DB_CA_CERT || ""
  };
}
