import { withDb } from "../db/client.js";
import archiver from "archiver";
import type { Readable } from "node:stream";

export interface ExportData {
  profile: {
    productUserId: string;
    identities: {
      provider: string;
      oidcSubject: string;
      email: string | null;
      displayName: string | null;
      oidcDisplayName: string | null;
      createdAt: string;
    }[];
  };
  messages: {
    id: string;
    channelId: string;
    content: string;
    createdAt: string;
    updatedAt: string | null;
    isDeleted: boolean;
  }[];
  dmChannels: {
    channelId: string;
    participants: { productUserId: string; displayName: string | null }[];
  }[];
  serverMemberships: { serverId: string; joinedAt?: string }[];
  hubMemberships: { hubId: string }[];
  roleBindings: { role: string; hubId: string | null; serverId: string | null }[];
  reactions: { messageId: string; emoji: string }[];
  reportsFiled: { id: string; reason: string; createdAt: string }[];
  blocks: { blockedUserId: string }[];
}

export async function gatherExportData(productUserId: string): Promise<ExportData> {
  return withDb(async (db) => {
    const identityRows = await db.query<{
      provider: string; oidc_subject: string; email: string | null;
      display_name: string | null; oidc_display_name: string | null; created_at: string;
    }>(
      `select provider, oidc_subject, display_name, oidc_display_name, email, created_at
       from identity_mappings where product_user_id = $1`,
      [productUserId]
    );

    const messageRows = await db.query<{
      id: string; channel_id: string; content: string;
      created_at: string; updated_at: string | null;
    }>(
      `select id, channel_id, content, created_at, updated_at
       from chat_messages where author_user_id = $1 order by created_at asc`,
      [productUserId]
    );

    const dmRows = await db.query<{
      channel_id: string; product_user_id: string; display_name: string | null;
    }>(
      `select cm.channel_id, im.product_user_id, im.display_name
       from channel_members cm
       join identity_mappings im on im.product_user_id = cm.product_user_id
       where cm.channel_id in (
         select id from channels where type = 'dm'
         and id in (select channel_id from channel_members where product_user_id = $1)
       )`,
      [productUserId]
    );

    const serverRows = await db.query<{ server_id: string }>(
      "select server_id from server_members where product_user_id = $1", [productUserId]
    );

    const hubRows = await db.query<{ hub_id: string }>(
      "select hub_id from hub_members where product_user_id = $1", [productUserId]
    );

    const roleRows = await db.query<{ role: string; hub_id: string | null; server_id: string | null }>(
      "select role, hub_id, server_id from role_bindings where product_user_id = $1", [productUserId]
    );

    const reactionRows = await db.query<{ message_id: string; emoji: string }>(
      "select message_id, emoji from message_reactions where user_id = $1", [productUserId]
    );

    const reportRows = await db.query<{ id: string; reason: string; created_at: string }>(
      "select id, reason, created_at from reports where reporter_user_id = $1", [productUserId]
    );

    const blockRows = await db.query<{ blocked_user_id: string }>(
      "select blocked_user_id from blocks where blocker_user_id = $1", [productUserId]
    );

    const dmMap = new Map<string, { productUserId: string; displayName: string | null }[]>();
    for (const r of dmRows.rows) {
      const list = dmMap.get(r.channel_id) || [];
      list.push({ productUserId: r.product_user_id, displayName: r.display_name });
      dmMap.set(r.channel_id, list);
    }

    return {
      profile: {
        productUserId,
        identities: identityRows.rows.map((r) => ({
          provider: r.provider,
          oidcSubject: r.oidc_subject,
          email: r.email,
          displayName: r.display_name,
          oidcDisplayName: r.oidc_display_name,
          createdAt: r.created_at,
        })),
      },
      messages: messageRows.rows.map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        content: r.content,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        isDeleted: false,
      })),
      dmChannels: [...dmMap.entries()].map(([channelId, participants]) => ({
        channelId,
        participants,
      })),
      serverMemberships: serverRows.rows.map((r) => ({ serverId: r.server_id })),
      hubMemberships: hubRows.rows.map((r) => ({ hubId: r.hub_id })),
      roleBindings: roleRows.rows.map((r) => ({
        role: r.role,
        hubId: r.hub_id,
        serverId: r.server_id,
      })),
      reactions: reactionRows.rows.map((r) => ({
        messageId: r.message_id,
        emoji: r.emoji,
      })),
      reportsFiled: reportRows.rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        createdAt: r.created_at,
      })),
      blocks: blockRows.rows.map((r) => ({ blockedUserId: r.blocked_user_id })),
    };
  });
}

/**
 * Build a ZIP archive of the export data and pipe it to the response.
 */
export async function buildExportZip(productUserId: string, res: NodeJS.WritableStream): Promise<void> {
  const data = await gatherExportData(productUserId);

  return new Promise<void>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    archive.on("end", resolve);

    archive.pipe(res);

    archive.append(JSON.stringify(data.profile, null, 2), { name: "profile.json" });
    archive.append(JSON.stringify(data.messages, null, 2), { name: "messages.json" });
    archive.append(JSON.stringify(data.dmChannels, null, 2), { name: "dm_channels.json" });
    archive.append(JSON.stringify(data.serverMemberships, null, 2), { name: "server_memberships.json" });
    archive.append(JSON.stringify(data.hubMemberships, null, 2), { name: "hub_memberships.json" });
    archive.append(JSON.stringify(data.roleBindings, null, 2), { name: "role_bindings.json" });
    archive.append(JSON.stringify(data.reactions, null, 2), { name: "reactions.json" });
    archive.append(JSON.stringify(data.reportsFiled, null, 2), { name: "reports_filed.json" });
    archive.append(JSON.stringify(data.blocks, null, 2), { name: "blocks.json" });
    archive.append(JSON.stringify({
      exportedAt: new Date().toISOString(),
      productUserId,
      categories: Object.keys(data).length,
    }, null, 2), { name: "manifest.json" });

    archive.finalize();
  });
}
