import { Pool } from "pg";
import { config } from "../config.js";

const isTestEnv = process.env.NODE_ENV === "test";

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      max: 30, // Increased from default 10 for better concurrency during bursts
      connectionTimeoutMillis: 5000, // Fail fast if we can't get a connection
      // In tests, collapse the idle timeout so `node --test` can exit
      // promptly after the last assertion (otherwise idle connections keep
      // the event loop alive for the full 30s).
      idleTimeoutMillis: isTestEnv ? 500 : 30000,
    })
  : null;

export async function withDb<T>(fn: (db: Pool) => Promise<T>): Promise<T> {
  if (!pool) {
    throw new Error("DATABASE_URL must be configured for persistence-backed APIs.");
  }

  return fn(pool);
}

import { runner } from "node-pg-migrate";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function initDb(): Promise<void> {
  if (!config.databaseUrl) {
    return;
  }

  await runner({
    databaseUrl: config.databaseUrl,
    dir: path.resolve(__dirname, "../../migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    verbose: true,
  });
}
