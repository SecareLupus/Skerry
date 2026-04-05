import crypto from "node:crypto";
import { withDb } from "../../db/client.js";

export async function addReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `insert into message_reactions(id, message_id, user_id, emoji)
       values($1, $2, $3, $4)
       on conflict(message_id, user_id, emoji) do nothing`,
      [`react_${crypto.randomUUID().replaceAll("-", "")}`, input.messageId, input.userId, input.emoji]
    );
  });
}

export async function removeReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `delete from message_reactions
       where message_id = $1 and user_id = $2 and emoji = $3`,
      [input.messageId, input.userId, input.emoji]
    );
  });
}
