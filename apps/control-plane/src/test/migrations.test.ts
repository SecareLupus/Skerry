import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { resetDb } from "./helpers/reset-db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

async function listMigrations(): Promise<string[]> {
  const res = await pool!.query<{ name: string }>(
    "select name from pgmigrations order by name"
  );
  return res.rows.map((r) => r.name);
}

async function snapshotSchema(): Promise<Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>> {
  const res = await pool!.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `select table_name, column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public'
      order by table_name, column_name`
  );
  return res.rows;
}

test("Migrations: applying up a second time is a no-op", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  const before = await listMigrations();
  // The beforeEach already ran the first `up`; run it again and confirm no change.
  await initDb();
  const after = await listMigrations();

  assert.deepEqual(after, before, "second up must not add new migrations");
});

test("Migrations: latest migration round-trips down then up cleanly (pgmigrations + schema)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.databaseUrl) { t.skip("DATABASE_URL not configured."); return; }

  // Snapshot the head state.
  const beforeMigrations = await listMigrations();
  const beforeSchema = await snapshotSchema();
  assert.ok(beforeMigrations.length > 0, "expected at least one migration to be applied");

  // Roll back the latest migration.
  await runner({
    databaseUrl: config.databaseUrl,
    dir: migrationsDir,
    direction: "down",
    migrationsTable: "pgmigrations",
    count: 1,
    verbose: false,
  });

  const afterDown = await listMigrations();
  assert.equal(
    afterDown.length,
    beforeMigrations.length - 1,
    "down should remove exactly one migration"
  );

  // Re-apply.
  await runner({
    databaseUrl: config.databaseUrl,
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    verbose: false,
  });

  const afterUp = await listMigrations();
  const afterSchema = await snapshotSchema();

  assert.deepEqual(afterUp, beforeMigrations, "migrations after roundtrip must match original set");
  assert.deepEqual(afterSchema, beforeSchema, "schema after roundtrip must match original schema");
});
