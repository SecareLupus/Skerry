// One-time backfill: pre-existing Discord-relayed reactions stored only the
// emoji name (e.g. "myEmoji") because the bot used to drop the snowflake ID.
// The frontend can't render those as images. New reactions store the full
// Discord tag (`<:name:id>` / `<a:name:id>`) so the renderer parses them and
// hits the CDN. This migration rewrites the old rows to the same tag format
// where `discord_seen_emojis` knows the ID, so the UI reflects them too.
//
// Edge case: if a user reacted both with the bare name AND (post-fix) with
// the tag format on the same message, the UPDATE skips that row to avoid the
// (message_id, user_id, emoji) unique-constraint conflict; the leftover
// bare-name row stays in place and still renders as text. Rare, harmless.

export const up = (pgm) => {
    pgm.sql(`
        UPDATE message_reactions mr
        SET emoji = '<' || (CASE WHEN dse.is_animated THEN 'a' ELSE '' END) || ':' || dse.name || ':' || dse.id || '>'
        FROM (
            SELECT DISTINCT ON (name) id, name, is_animated
            FROM discord_seen_emojis
            ORDER BY name, last_seen_at DESC
        ) dse
        WHERE mr.emoji = dse.name
          AND mr.emoji ~ '^[a-zA-Z0-9_]+$'
          AND NOT EXISTS (
              SELECT 1 FROM message_reactions other
              WHERE other.message_id = mr.message_id
                AND other.user_id = mr.user_id
                AND other.emoji = '<' || (CASE WHEN dse.is_animated THEN 'a' ELSE '' END) || ':' || dse.name || ':' || dse.id || '>'
                AND other.id <> mr.id
          );
    `);
};

// No-op down. The bare-name format isn't recoverable from the tag, and
// reverting wouldn't fix anything — old clients render the tag fine too.
export const down = () => {};
