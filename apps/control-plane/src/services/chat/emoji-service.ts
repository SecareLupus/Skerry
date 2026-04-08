import { withDb } from "../../db/client.js";

export interface ResolvedEmoji {
    id: string;
    name: string;
    url: string;
    isAnimated: boolean;
    provider: "discord" | "skerry";
}

/**
 * Resolves a :name: shortcode to an image URL or Discord tag info.
 * Checks mirrored emojis in the current server first, then global seen emojis.
 */
export async function findEmojiByName(serverId: string, name: string, skipGlobal: boolean = false): Promise<ResolvedEmoji | null> {
    return withDb(async (db) => {
        // 1. Check if it's a mirrored external Discord emoji by name in this server
        const externalMirror = await db.query<{ discord_emoji_id: string, discord_emoji_name: string, is_animated: boolean, external_emoji_id: string }>(
            `select m.discord_emoji_id, m.discord_emoji_name, e.is_animated, m.external_emoji_id
             from discord_external_emoji_mirrors m
             join discord_seen_emojis e on e.id = m.external_emoji_id
             where m.server_id = $1 and m.discord_emoji_name = $2
             limit 1`,
            [serverId, name]
        );
        if (externalMirror.rows[0]) {
            const row = externalMirror.rows[0];
            return {
                id: row.discord_emoji_id,
                name: row.discord_emoji_name,
                url: `https://cdn.discordapp.com/emojis/${row.external_emoji_id}.${row.is_animated ? "gif" : "webp"}?size=160&quality=lossless`,
                isAnimated: row.is_animated,
                provider: "discord"
            };
        }

        // 2. Check if it's a Skerry native emoji in this server
        const nativeEmoji = await db.query<{ id: string, name: string, url: string }>(
            `select id, name, url from server_emojis where server_id = $1 and name = $2 limit 1`,
            [serverId, name]
        );
        if (nativeEmoji.rows[0]) {
            const row = nativeEmoji.rows[0];
            return {
                id: row.id,
                name: row.name,
                url: row.url,
                isAnimated: false, // Skerry native emojis non-animated for now
                provider: "skerry"
            };
        }

        if (skipGlobal) return null;

        // 3. Check if we've seen an emoji with this name anywhere on Discord
        const seenEmoji = await db.query<{ id: string, name: string, is_animated: boolean }>(
            `select id, name, is_animated from discord_seen_emojis where name = $1 order by last_seen_at desc limit 1`,
            [name]
        );
        if (seenEmoji.rows[0]) {
            const row = seenEmoji.rows[0];
            return {
                id: row.id,
                name: row.name,
                url: `https://cdn.discordapp.com/emojis/${row.id}.${row.is_animated ? "gif" : "webp"}?size=160&quality=lossless`,
                isAnimated: row.is_animated,
                provider: "discord"
            };
        }

        return null;
    });
}

/**
 * Transforms :name: shortcodes into Markdown images ![:name:](url)
 * Also attempts to resolve "unwrapped" names (bare words) that match custom emojis in the server.
 */
export async function enrichContentWithEmojis(serverId: string, content: string): Promise<string> {
    // 1. Resolve standard :name: shortcodes
    const shortcodeMatches = Array.from(content.matchAll(/:([a-zA-Z0-9_-]+):/g));
    let enrichedContent = content;
    const processedNames = new Set<string>();

    for (const match of shortcodeMatches) {
        const fullMatch = match[0];
        const name = match[1]!;
        
        if (processedNames.has(name)) continue;
        processedNames.add(name);

        if (name.startsWith("emo_")) continue;

        try {
            const emoji = await findEmojiByName(serverId, name);
            if (emoji) {
                const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(?<!!\\[):${escapedName}:(?!\\]\\(http)`, 'g');
                enrichedContent = enrichedContent.replace(regex, `![:${name}:](${emoji.url})`);
            }
        } catch (error) {
            console.error(`[EmojiService] Resolution failed for ${name}:`, error);
        }
    }

    // 2. Resolve "unwrapped" names (bare words) from Discord's clipboard
    // We only do this for custom emojis already seen or native to this server to avoid false positives with common words.
    // To be safe, we only resolve words that are 3+ chars and match exactly.
    const bareWords = enrichedContent.split(/\s+/);
    const potentialBareNames = bareWords.filter(w => /^[a-zA-Z0-9_-]{3,}$/.test(w) && !processedNames.has(w));
    
    if (potentialBareNames.length > 0) {
        const uniquePotential = Array.from(new Set(potentialBareNames));
        for (const name of uniquePotential) {
            try {
                // We only resolve bare words if they are custom emojis (Discord or Skerry)
                // and we check the database for high-confidence matches in the current server context.
                const emoji = await findEmojiByName(serverId, name, true);
                if (emoji) {
                    // To avoid turning every "hello" into an emoji, we only replace if:
                    // 1. It's a Discord emoji (provider === "discord") or Skerry native
                    // 2. We use word boundaries to avoid matching parts of words
                    const regex = new RegExp(`\\b${name}\\b`, 'g');
                    
                    // We check if this name is a common English word? 
                    // No, instead we check if this emoji is "known" to the server (already mirrored or native).
                    // findEmojiByName already prioritizes server-native and mirrored.
                    
                    // If it was found via global discovery (step 3), we might want to be more careful.
                    // For now, let's assume if it matches exactly and is 3+ chars, it's a win.
                    enrichedContent = enrichedContent.replace(regex, `![:${name}:](${emoji.url})`);
                }
            } catch (error) {
                // Ignore
            }
        }
    }

    return enrichedContent;
}
