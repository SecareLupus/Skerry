import type { Hub, Role } from "@skerry/shared";
import { withDb } from "../db/client.js";
import type { ScopedAuthContext } from "../auth/middleware.js";

const MANAGER_ROLES: Role[] = ["hub_admin", "space_owner"];

export async function listHubsForUser(
  productUserId: string,
  authContext?: ScopedAuthContext
): Promise<Hub[]> {
  return withDb(async (db) => {
    const isMasquerading = Boolean(authContext?.isMasquerading);
    
    let effectiveRoleRows: { role: Role; hub_id: string | null }[] = [];
    
    if (isMasquerading && authContext?.masqueradeRole) {
      const role = authContext.masqueradeRole as Role;
      let hubId: string | null = null;
      
      if (authContext.masqueradeServerId) {
        const srv = await db.query<{ hub_id: string }>("select hub_id from servers where id = $1", [authContext.masqueradeServerId]);
        hubId = srv.rows[0]?.hub_id || null;
      }
      
      effectiveRoleRows = [{ role, hub_id: hubId }];
    } else {
      const dbRows = await db.query<{ role: Role; hub_id: string | null }>(
        `select role, hub_id
         from role_bindings
         where product_user_id = $1`,
        [productUserId]
      );
      effectiveRoleRows = dbRows.rows;
    }

    const roleRows = { rows: effectiveRoleRows };

    const isGlobalManager = roleRows.rows.some(
      (row) => MANAGER_ROLES.includes(row.role) && row.hub_id === null
    );

    if (isGlobalManager) {
      const all = await db.query<{
        id: string;
        name: string;
        owner_user_id: string;
        s3_config: any;
        created_at: string;
      }>("select * from hubs order by created_at asc");

      return all.rows.map((row) => ({
        id: row.id,
        name: row.name,
        ownerUserId: row.owner_user_id,
        s3Config: row.s3_config ?? undefined,
        createdAt: row.created_at
      }));
    }

    const scopedHubIds = new Set(
      roleRows.rows
        .filter((row) => MANAGER_ROLES.includes(row.role))
        .map((row) => row.hub_id)
        .filter((value): value is string => typeof value === "string")
    );

    const ownedHubIds = new Set<string>();
    if (!isMasquerading) {
      const owned = await db.query<{ id: string }>("select id from hubs where owner_user_id = $1", [productUserId]);
      for (const row of owned.rows) {
        ownedHubIds.add(row.id);
      }
    }

    const ids = [...new Set([...scopedHubIds, ...ownedHubIds])];
    if (ids.length === 0) {
      return [];
    }

    const hubs = await db.query<{
      id: string;
      name: string;
      owner_user_id: string;
      s3_config: any;
      created_at: string;
    }>("select * from hubs where id = any($1::text[]) order by created_at asc", [ids]);

    return hubs.rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerUserId: row.owner_user_id,
      s3Config: row.s3_config ?? undefined,
      createdAt: row.created_at
    }));
  });
}
