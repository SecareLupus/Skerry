import { pool } from "../../db/client.js";

const PRESERVED_TABLES = new Set<string>([
  "pgmigrations",
  "platform_settings",
]);

let cachedTables: string[] | null = null;

async function discoverTables(): Promise<string[]> {
  if (cachedTables) return cachedTables;
  if (!pool) return [];
  const { rows } = await pool.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'`
  );
  cachedTables = rows
    .map((r) => r.table_name)
    .filter((name) => !PRESERVED_TABLES.has(name));
  return cachedTables;
}

export function invalidateResetDbCache(): void {
  cachedTables = null;
}

export async function resetDb(): Promise<void> {
  if (!pool) return;
  const tables = await discoverTables();
  if (tables.length === 0) return;

  const qualified = tables.map((t) => `"${t}"`).join(", ");
  await pool.query("begin");
  try {
    await pool.query(`truncate table ${qualified} restart identity cascade`);
    await pool.query(
      "update platform_settings set bootstrap_completed_at = null, bootstrap_admin_user_id = null, bootstrap_hub_id = null, default_server_id = null, default_channel_id = null where id = 'global'"
    );
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}
