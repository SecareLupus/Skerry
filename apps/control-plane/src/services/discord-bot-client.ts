import { Client, GatewayIntentBits, Events, Message, TextChannel, WebhookClient, ChannelType, Partials, MessageReaction, Guild } from "discord.js";
import { config } from "../config.js";
import { relayDiscordMessageToMappedChannel } from "./discord-bridge-service.js";
import { logEvent } from "./observability-service.js";
import { withDb } from "../db/client.js";
import fs from "node:fs";
import path from "node:path";
import { findEmojiByName } from "./chat/emoji-service.js";

let client: Client | null = null;
let isStarting = false;
const webhookCache = new Map<string, WebhookClient>();
const presenceCache = new Map<string, {
    data: Record<string, { username: string, displayName: string, status: string, avatarUrl: string | null }>,
    isSeeded: boolean,
    lastFullSyncAt: number
}>();
const PRESENCE_CACHE_TTL_MS = 60 * 1000; // Increased to 1 min for gateway-backed cache
const ANTI_ENTROPY_INTERVAL_MS = 10 * 60 * 1000; // Check stalest guild every 10 mins

// Encode a Discord reaction's emoji into a string the rest of the system can store and compare.
// Custom emoji preserve their ID using Discord's native `<:name:id>` / `<a:name:id>` syntax so
// the frontend can resolve the CDN URL without a DB lookup. Unicode emoji pass through as the
// raw character.
export function encodeDiscordReactionEmoji(emoji: { id: string | null; name: string | null; animated: boolean | null }): string | null {
    if (!emoji.name) return null;
    if (emoji.id) return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    return emoji.name;
}

export async function startDiscordBot() {
    if (isStarting) return;
    if (client && client.isReady()) return;

    if (config.discordBridge.mockMode || !config.discordBotToken || config.discordBotToken === "REPLACE_ME_IN_PORTAL") {
        logEvent("info", "discord_bot_skipped", { reason: config.discordBridge.mockMode ? "mock_mode" : "missing_token" });
        return;
    }

    isStarting = true;
    try {
        client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessageTyping,
                GatewayIntentBits.GuildMessageReactions
            ],
            partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User, Partials.Reaction]
        });

        client.on(Events.MessageCreate, async (message: Message) => {
            if (message.author.bot) return;

            // Find all servers that have a mapping for this Discord channel (or its parent if it's a thread)
            const discordChannelIdForMapping = message.channel.isThread() ? (message.channel as any).parentId : message.channelId;
            const serverIds = await withDb(async (db) => {
                const rows = await db.query<{ server_id: string }>(
                    "select server_id from discord_bridge_channel_mappings where guild_id = $1 and discord_channel_id = $2 and enabled = true",
                    [message.guildId, discordChannelIdForMapping]
                );
                return rows.rows.map(r => r.server_id);
            });

            if (serverIds.length === 0) return;

            for (const serverId of serverIds) {
                try {
                    const media = [
                        ...message.attachments.map(a => ({ url: a.url, sourceUrl: a.url })),
                        ...message.stickers.map(s => {
                            const isPng = s.format === 1;
                            const isApng = s.format === 2;
                            const isLottie = s.format === 3;
                            const isGif = s.format === 4;
                            
                            // As per Discord docs, stickers are available in their native formats:
                            // PNG/APNG -> .png, GIF -> .gif, Lottie -> .json
                            // Size parameter is ignored for stickers.
                            const ext = isLottie ? "json" : isGif ? "gif" : "png";
                            
                            return { 
                                url: `https://cdn.discordapp.com/stickers/${s.id}.${ext}`, 
                                sourceUrl: s.url, 
                                filename: `${s.name}.${ext}`,
                                isSticker: true 
                            };
                        }),
                        ...message.embeds.map((e: any) => {
                            let url = e.data.video?.proxy_url || e.data.image?.proxy_url || e.data.thumbnail?.proxy_url || 
                                      e.data.video?.url || e.data.image?.url || e.data.thumbnail?.url;

                            // If it's a gifv (Giphy/Tenor), ensure we have a format that can be rendered as an image
                            if (e.data?.type === 'gifv' && url) {
                                if (url.includes('giphy.com') || url.includes('tenor.com')) {
                                    // Use .gif as the base; the bridge service will then prefer .webp if it's a Discord proxy URL
                                    url = url.replace('.mp4', '.gif').replace('.webm', '.gif');
                                }
                            }

                            return url ? { url, sourceUrl: e.data.url || url } : null;
                        }).filter(Boolean) as Array<{ url: string; sourceUrl: string; filename?: string; isSticker?: boolean }>
                    ];

                    await relayDiscordMessageToMappedChannel({
                        serverId,
                        discordChannelId: message.channel.isThread() ? (message.channel as any).parentId : message.channelId,
                        authorId: message.author.id,
                        authorName: message.member?.displayName ?? message.author.displayName ?? message.author.username,
                        authorAvatarUrl: message.author.displayAvatarURL({ extension: 'webp', size: 128 }),
                        content: message.content,
                        messageId: message.id,
                        media,
                        replyToId: !message.channel.isThread() ? (message.reference?.messageId ?? undefined) : undefined,
                        externalThreadId: message.channel.isThread() ? message.channelId : undefined
                    });

                    // Explicitly stop typing when a message is received
                    const matrixChannelId = await withDb(async (db) => {
                        const row = await db.query<{ matrix_channel_id: string }>(
                            "select matrix_channel_id from discord_bridge_channel_mappings where server_id = $1 and discord_channel_id = $2",
                            [serverId, discordChannelIdForMapping]
                        );
                        return row.rows[0]?.matrix_channel_id;
                    });

                    if (matrixChannelId) {
                        const { publishHubEvent } = await import("./chat-realtime.js");
                        const hubId = await withDb(async (db) => {
                            const row = await db.query<{ hub_id: string }>(
                                "select hub_id from hubs h join servers s on s.hub_id = h.id where s.id = $1",
                                [serverId]
                            );
                            return row.rows[0]?.hub_id;
                        });
                        if (hubId) {
                            publishHubEvent(hubId, "typing.stop", {
                                channelId: matrixChannelId,
                                userId: `discord_${message.author.id}`,
                                displayName: message.member?.displayName ?? message.author.displayName ?? message.author.username
                            });
                        }
                    }
                } catch (error) {
                    logEvent("error", "discord_relay_failed", { serverId, messageId: message.id, error: String(error) });
                }
            }
        });

        client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
            if (newMessage.partial) {
                try {
                    await newMessage.fetch();
                } catch (error) {
                    console.error("[Discord Bridge] Failed to fetch partial updated message:", error);
                    return;
                }
            }
            if (newMessage.author?.bot) return;

            const contentChanged = oldMessage.content !== newMessage.content;
            const pinChanged = oldMessage.pinned !== newMessage.pinned;

            if (!contentChanged && !pinChanged) return;

            const discordChannelIdForMapping = newMessage.channel.isThread() ? (newMessage.channel as any).parentId : newMessage.channelId;
            const serverIds = await withDb(async (db) => {
                const rows = await db.query<{ server_id: string }>(
                    "select server_id from discord_bridge_channel_mappings where guild_id = $1 and discord_channel_id = $2 and enabled = true",
                    [newMessage.guildId, discordChannelIdForMapping]
                );
                return rows.rows.map(r => r.server_id);
            });

            for (const serverId of serverIds) {
                try {
                    if (contentChanged) {
                        const { updateRelayedDiscordMessage } = await import("./discord-bridge-service.js");
                        await updateRelayedDiscordMessage({
                            serverId,
                            discordChannelId: String(discordChannelIdForMapping),
                            externalMessageId: newMessage.id,
                            content: newMessage.content || ""
                        });
                    }

                    if (pinChanged) {
                        const { pinMessage, unpinMessage } = await import("./chat/message-service.js");
                        const skerryMessageId = await withDb(async (db) => {
                            const row = await db.query<{ id: string }>(
                                "select id from chat_messages where external_message_id = $1 and external_provider = 'discord' limit 1",
                                [newMessage.id]
                            );
                            return row.rows[0]?.id;
                        });

                        if (skerryMessageId) {
                            if (newMessage.pinned) {
                                await pinMessage({ messageId: skerryMessageId, actorUserId: "discord_bridged_user" } as any);
                            } else {
                                await unpinMessage({ messageId: skerryMessageId, actorUserId: "discord_bridged_user" } as any);
                            }
                        }
                    }
                } catch (error) {
                    logEvent("error", "discord_update_relay_failed", { serverId, messageId: newMessage.id, error: String(error) });
                }
            }
        });

        client.on(Events.MessageDelete, async (message) => {
            // We need guildId even for partial messages
            let guildId = message.guildId;
            let channelId = message.channelId;

            if (message.partial && !guildId) {
                try {
                    // If we don't have guildId, we might not even be able to fetch it if it's already deleted
                    // but we can try fetching the channel if we have channelId
                } catch (err) {}
            }

            if (message.author?.bot) return;

            const discordChannelIdForMapping = message.channel.isThread() ? (message.channel as any).parentId : channelId;
            const serverIds = await withDb(async (db) => {
                const rows = await db.query<{ server_id: string }>(
                    "select server_id from discord_bridge_channel_mappings where guild_id = $1 and discord_channel_id = $2 and enabled = true",
                    [guildId, discordChannelIdForMapping]
                );
                return rows.rows.map(r => r.server_id);
            });

            for (const serverId of serverIds) {
                try {
                    const { deleteRelayedDiscordMessage } = await import("./discord-bridge-service.js");
                    await deleteRelayedDiscordMessage({
                        serverId,
                        discordChannelId: String(discordChannelIdForMapping),
                        externalMessageId: message.id
                    });
                } catch (error) {
                    logEvent("error", "discord_delete_relay_failed", { serverId, messageId: message.id, error: String(error) });
                }
            }
        });

        client.on(Events.MessageReactionAdd, async (reaction, user) => {
            if (user.bot) return;
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.error("[Discord Bridge] Failed to fetch partial reaction:", error);
                    return;
                }
            }

            const message = reaction.message;
            const guildId = message.guildId;
            const channelId = message.channelId;
            const emoji = encodeDiscordReactionEmoji(reaction.emoji);
            if (!emoji) return;

            const discordChannelIdForMapping = message.channel.isThread() ? (message.channel as any).parentId : channelId;
            const serverIds = await withDb(async (db) => {
                const rows = await db.query<{ server_id: string }>(
                    "select server_id from discord_bridge_channel_mappings where guild_id = $1 and discord_channel_id = $2 and enabled = true",
                    [guildId, discordChannelIdForMapping]
                );
                return rows.rows.map(r => r.server_id);
            });

            for (const serverId of serverIds) {
                try {
                    const { addReaction } = await import("./chat/reaction-service.js");
                    // We need the Skerry message ID mapped from the Discord message ID
                    const skerryMessageId = await withDb(async (db) => {
                        const row = await db.query<{ id: string }>(
                            "select id from chat_messages where external_message_id = $1 and external_provider = 'discord' limit 1",
                            [message.id]
                        );
                        return row.rows[0]?.id;
                    });

                    if (skerryMessageId) {
                        const { upsertIdentityMapping } = await import("./identity-service.js");
                        const identity = await upsertIdentityMapping({
                            provider: "discord",
                            oidcSubject: user.id,
                            email: null,
                            preferredUsername: user.username,
                            avatarUrl: user.displayAvatarURL(),
                        });

                        await addReaction({
                            messageId: skerryMessageId,
                            userId: identity.productUserId,
                            emoji: emoji,
                            isRelay: true
                        } as any);
                    }
                } catch (error) {
                    logEvent("error", "discord_reaction_relay_failed", { serverId, messageId: message.id, error: String(error) });
                }
            }
        });

        client.on(Events.MessageReactionRemove, async (reaction, user) => {
            if (user.bot) return;
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.error("[Discord Bridge] Failed to fetch partial reaction remove:", error);
                    return;
                }
            }

            const message = reaction.message;
            const emoji = encodeDiscordReactionEmoji(reaction.emoji);
            if (!emoji) return;

            const discordChannelIdForMapping = message.channel.isThread() ? (message.channel as any).parentId : message.channelId;
            const serverIds = await withDb(async (db) => {
                const rows = await db.query<{ server_id: string }>(
                    "select server_id from discord_bridge_channel_mappings where guild_id = $1 and discord_channel_id = $2 and enabled = true",
                    [message.guildId, discordChannelIdForMapping]
                );
                return rows.rows.map(r => r.server_id);
            });

            for (const serverId of serverIds) {
                try {
                    const { removeReaction } = await import("./chat/reaction-service.js");
                    const skerryMessageId = await withDb(async (db) => {
                        const row = await db.query<{ id: string }>(
                            "select id from chat_messages where external_message_id = $1 and external_provider = 'discord' limit 1",
                            [message.id]
                        );
                        return row.rows[0]?.id;
                    });

                    if (skerryMessageId) {
                        const { upsertIdentityMapping } = await import("./identity-service.js");
                        const identity = await upsertIdentityMapping({
                            provider: "discord",
                            oidcSubject: user.id,
                            email: null,
                            preferredUsername: user.username,
                            avatarUrl: user.displayAvatarURL(),
                        });

                        await removeReaction({
                            messageId: skerryMessageId,
                            userId: identity.productUserId,
                            emoji: emoji,
                            isRelay: true
                        } as any);
                    }
                } catch (error) {
                    logEvent("error", "discord_reaction_remove_relay_failed", { serverId, messageId: message.id, error: String(error) });
                }
            }
        });

        client.on(Events.TypingStart, async (typing) => {
            if (typing.user.bot) return;

            const discordChannelIdForMapping = typing.channel.isThread() ? (typing.channel as any).parentId : typing.channel.id;
            const serverIds = await withDb(async (db) => {
                const rows = await db.query<{ server_id: string }>(
                    "select server_id from discord_bridge_channel_mappings where guild_id = $1 and discord_channel_id = $2 and enabled = true",
                    [typing.guild?.id, discordChannelIdForMapping]
                );
                return rows.rows.map(r => r.server_id);
            });

            for (const serverId of serverIds) {
                // Find the Matrix channel ID for this mapping
                const matrixChannelId = await withDb(async (db) => {
                    const row = await db.query<{ matrix_channel_id: string }>(
                        "select matrix_channel_id from discord_bridge_channel_mappings where server_id = $1 and discord_channel_id = $2",
                        [serverId, discordChannelIdForMapping]
                    );
                    return row.rows[0]?.matrix_channel_id;
                });

                if (matrixChannelId) {
                    const { publishHubEvent } = await import("./chat-realtime.js"); 
                    // Need to find hubId
                    const hubId = await withDb(async (db) => {
                        const row = await db.query<{ hub_id: string }>(
                            "select hub_id from hubs h join servers s on s.hub_id = h.id where s.id = $1",
                            [serverId]
                        );
                        return row.rows[0]?.hub_id;
                    });
                    if (hubId) {
                       publishHubEvent(hubId, "typing.start", { 
                           channelId: matrixChannelId, 
                           userId: `discord_${typing.user.id}`,
                           displayName: typing.member?.displayName ?? typing.user.username
                       });
                    }
                }
            }
        });

        // Presence gateway listeners
        client.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
            if (!newPresence.guild || !newPresence.member) return;
            const guildId = newPresence.guild.id;
            const cache = presenceCache.get(guildId);
            if (!cache) return;

            cache.data[newPresence.member.id] = {
                username: newPresence.member.user.username,
                displayName: newPresence.member.displayName,
                status: newPresence.status ?? "offline",
                avatarUrl: newPresence.member.user.displayAvatarURL()
            };
        });

        client.on(Events.GuildMemberAdd, (member) => {
            const cache = presenceCache.get(member.guild.id);
            if (!cache) return;
            cache.data[member.id] = {
                username: member.user.username,
                displayName: member.displayName,
                status: member.presence?.status ?? "offline",
                avatarUrl: member.user.displayAvatarURL()
            };
        });

        client.on(Events.GuildMemberRemove, (member) => {
            const cache = presenceCache.get(member.guild.id);
            if (!cache) return;
            delete cache.data[member.id];
        });

        client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
            const cache = presenceCache.get(newMember.guild.id);
            if (!cache) return;
            cache.data[newMember.id] = {
                username: newMember.user.username,
                displayName: newMember.displayName,
                status: newMember.presence?.status ?? "offline",
                avatarUrl: newMember.user.displayAvatarURL()
            };
        });

        await client.login(config.discordBotToken);

        // Start background tasks after login
        provisionProjectEmoji().catch(err => console.error("Failed to provision project app emoji:", err));
        seedPresenceCache().catch(err => console.error("Failed initial presence seeding:", err));
        startAntiEntropyLoop();

    } catch (error) {
        logEvent("error", "discord_bot_login_failed", { error: String(error) });
        client = null;
    } finally {
        isStarting = false;
    }
}
// Keep track of channels where the bot is currently typing
const typingActivity = new Map<string, number>();

export function getDiscordBotClient() {
    return client;
}

// Upload the Skerry project logo as a bot-application emoji exactly once. Idempotent —
// re-runs are no-ops if the "skerry" app emoji already exists.
export async function provisionProjectEmoji() {
    if (!client || !client.isReady() || !client.application) return null;
    try {
        const emojis = await client.application.emojis.fetch();
        const existing = emojis.find(e => e.name === "skerry");
        if (existing) return existing;

        const logoPath = path.resolve(process.cwd(), config.discordBridge.projectLogoPath);
        if (!fs.existsSync(logoPath)) {
            logEvent("error", "discord_logo_not_found", { path: logoPath });
            return null;
        }

        const logoData = fs.readFileSync(logoPath);
        const emoji = await client.application.emojis.create({
            attachment: logoData,
            name: "skerry"
        });
        logEvent("info", "discord_emoji_provisioned", { emojiId: emoji.id });
        return emoji;
    } catch (error) {
        logEvent("error", "discord_emoji_provision_failed", { error: String(error) });
        return null;
    }
}

async function getWebhookForChannel(channel: any): Promise<WebhookClient | null> {
    let webhook = webhookCache.get(channel.id);
    if (!webhook) {
        try {
            const webhooks = await channel.fetchWebhooks();
            const existing = webhooks.find((wh: any) => wh.name === "Skerry Bridge");

            if (existing) {
                webhook = new WebhookClient({ id: existing.id, token: existing.token! });
            } else {
                const created = await channel.createWebhook({
                    name: "Skerry Bridge",
                    reason: "Automated bridge for Skerry community"
                });
                webhook = new WebhookClient({ id: created.id, token: created.token! });
            }
            webhookCache.set(channel.id, webhook);
        } catch (error) {
            logEvent("error", "discord_webhook_setup_failed", { channelId: channel.id, error: String(error) });
            return null;
        }
    }
    return webhook;
}

export async function relayMatrixMessageToDiscord(input: {
    serverId: string;
    discordChannelId: string;
    authorName: string;
    content: string;
    avatarUrl?: string; // Optional avatar from Matrix
    attachments?: Array<{ url: string; contentType: string; filename: string }>;
    parentId?: string; // Skerry parent message ID
    externalThreadId?: string; // Discord thread ID
    messageId?: string; // Skerry message ID
}) {
    if (!client || !client.isReady()) {
        // Try to start the bot if it's not ready
        await startDiscordBot();
        if (!client || !client.isReady()) return;
    }

    try {
        const allowedTypes: ChannelType[] = [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.GuildForum,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread
        ];

        // Resolve externalThreadId from parentId if provided but missing
        if (input.parentId && !input.externalThreadId) {
            await withDb(async (db) => {
                let currentParentId = input.parentId;
                let depth = 0;
                while (currentParentId && depth < 10) { // Limit depth to prevent infinite loops
                    const parent = await db.query<{ parent_id: string | null, external_thread_id: string | null }>(
                        "select parent_id, external_thread_id from chat_messages where id = $1 limit 1",
                        [currentParentId]
                    );
                    const row = parent.rows[0];
                    if (!row) break;

                    if (row.external_thread_id) {
                        input.externalThreadId = row.external_thread_id;
                        break;
                    }
                    currentParentId = row.parent_id!;
                    depth++;
                }
                if (!input.externalThreadId) {
                    logEvent("warn", "discord_thread_id_unresolved", { parentId: input.parentId });
                }
            });
        }

        let targetChannel = await client.channels.fetch(input.discordChannelId);
        if (!targetChannel) {
            logEvent("error", "discord_channel_fetch_failed", { channelId: input.discordChannelId });
            return;
        }

        if (!allowedTypes.includes(targetChannel.type as any)) {
            logEvent("warn", "discord_channel_type_unsupported", { channelId: input.discordChannelId, type: targetChannel.type });
            return;
        }

        const guild = (targetChannel as any).guild;
        // The "skerry" project emoji now lives on the bot application and renders
        // in any guild the bot is in, so we look it up there instead of per-guild.
        const appEmojis = client.application ? await client.application.emojis.fetch() : null;
        const skerryEmoji = appEmojis?.find((e: any) => e.name === "skerry") ?? null;

        let content = input.content;

        // --- Emoji Mirroring ---
        if (guild) {
            // 1. Handle Skerry Emojis (:emo_id:)
            const skerryEmojiMatches = content.match(/:emo_[a-zA-Z0-9_-]+:/g);
            if (skerryEmojiMatches) {
                for (const match of skerryEmojiMatches) {
                    const skerryEmojiId = match.slice(1, -1); // remove colons
                    const discordEmojiFound = await getOrMirrorSkerryEmojiToBotApp(skerryEmojiId);
                    if (discordEmojiFound) {
                        content = content.replace(match, `<:${discordEmojiFound.name}:${discordEmojiFound.id}>`);
                    }
                }
            }

            // 2. Handle Markdown Emojis ![:name:](url)
            // We catch:
            // - Discord CDN: https://cdn.discordapp.com/emojis/id.ext
            // - Skerry Native: /v1/emojis/emo_id
            const emojiMarkdownMatches = Array.from(content.matchAll(/!\[(?:|:)(.+?)(?:|:)\]\((?:https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.(webp|gif|png).*?|\/v1\/emojis\/(emo_[a-zA-Z0-9_-]+))\)/g));
            
            if (emojiMarkdownMatches.length > 0) {
                for (const match of emojiMarkdownMatches) {
                    const [fullMatch, name, discordId, , skerryEmojiId] = match;
                    if (typeof name !== "string") continue;
                    const cleanName = name.replace(/^:/, "").replace(/:$/, "");

                    if (discordId) {
                        const discordEmojiFound = await getOrMirrorExternalEmoji(input.serverId, guild.id, discordId, cleanName);
                        if (discordEmojiFound) {
                            const prefix = discordEmojiFound.isAnimated ? "a" : "";
                            content = content.replace(fullMatch, `<${prefix}:${discordEmojiFound.name}:${discordEmojiFound.id}>`);
                        }
                    } else if (skerryEmojiId) {
                        const discordEmojiFound = await getOrMirrorSkerryEmojiToBotApp(skerryEmojiId);
                        if (discordEmojiFound) {
                            content = content.replace(fullMatch, `<:${discordEmojiFound.name}:${discordEmojiFound.id}>`);
                        }
                    }
                }
            }

            // 3. Handle Emojis (Shortcodes & Bare Words)
            // We look for :name: and bare words that match known custom emojis
            const allWords = content.match(/:?[a-zA-Z0-9_-]+:?/g);
            if (allWords) {
                // Remove duplicates to avoid redundant processing
                const uniqueWords = Array.from(new Set(allWords));
                
                for (const word of uniqueWords) {
                    const isShortcode = word.startsWith(":") && word.endsWith(":");
                    const name = isShortcode ? word.slice(1, -1) : word;
                    
                    // Skip if it looks like a Skerry internal ID unless it's a shortcode we want to resolve
                    if (name.startsWith("emo_") && !isShortcode) continue;

                    // Resolve the emoji. For bare words, we skip global discovery to avoid false positives.
                    const emoji = await findEmojiByName(input.serverId, name, !isShortcode);
                    if (!emoji) continue;

                    if (emoji.provider === "discord") {
                        const fullEmoji = await getOrMirrorExternalEmoji(input.serverId, guild.id, emoji.id, emoji.name);
                        if (fullEmoji) {
                            const prefix = fullEmoji.isAnimated ? "a" : "";
                            const discordTag = `<${prefix}:${fullEmoji.name}:${fullEmoji.id}>`;
                            // Replace all occurrences using word boundaries for bare words
                            const regex = isShortcode ? new RegExp(word, 'g') : new RegExp(`\\b${word}\\b`, 'g');
                            content = content.replace(regex, discordTag);
                        }
                    } else if (emoji.provider === "skerry") {
                        const fullEmoji = await getOrMirrorSkerryEmojiToBotApp(emoji.id);
                        if (fullEmoji) {
                            const discordTag = `<:${fullEmoji.name}:${fullEmoji.id}>`;
                            const regex = isShortcode ? new RegExp(word, 'g') : new RegExp(`\\b${word}\\b`, 'g');
                            content = content.replace(regex, discordTag);
                        }
                    }
                }
            }

            // --- Mention Mirroring ---
            const mentionMatches = content.match(/@([a-zA-Z0-9_\-]+)/g);
            if (mentionMatches) {
                for (const match of mentionMatches) {
                    const username = match.slice(1);
                    const discordId = await withDb(async (db) => {
                        const row = await db.query<{ discord_user_id: string }>(
                            "select discord_user_id from identity_mappings where display_name = $1 and discord_user_id is not null limit 1",
                            [username]
                        );
                        return row.rows[0]?.discord_user_id;
                    });
                    if (discordId) {
                        content = content.replace(new RegExp(match, 'g'), `<@${discordId}>`);
                    }
                }
            }
        }

        if (skerryEmoji) {
            content = `${skerryEmoji} ${content}`;
        }

        const files = input.attachments?.map((a: any) => ({
            attachment: a.url,
            name: a.filename
        }));

        const username = skerryEmoji ? input.authorName : `${input.authorName} ${config.discordBridge.icon}`;

        // IMPORTANT: Resolve Webhook/Thread linkage logic
        let threadIdToUse = input.externalThreadId;
        let finalTargetChannel = targetChannel;

        // Forum Handling - Creating a New Thread
        if (targetChannel.type === ChannelType.GuildForum && !threadIdToUse) {
            // We need a webhook for the forum channel
            let webhook = await getWebhookForChannel(targetChannel as any);
            if (!webhook) return;

            const result = await webhook.send({
                username,
                content: content || (files && files.length > 0 ? "" : undefined),
                avatarURL: input.avatarUrl,
                files: files,
                threadName: input.content.slice(0, 50) || "Skerry Conversation",
                wait: true
            } as any);

            const response = result as any;
            const newThreadId = response.thread?.id || response.channelId || response.id;

            if (input.messageId && newThreadId) {
                await withDb(async (db) => {
                    await db.query(
                        "update chat_messages set external_thread_id = $1, external_message_id = $2, external_provider = 'discord' where id = $3",
                        [newThreadId, response.id, input.messageId]
                    );
                });
            }
            return;
        }

        // If it's a forum reply, we MUST redirect to the thread before calculating isThread/parentChannel
        if (targetChannel.type === ChannelType.GuildForum && threadIdToUse) {
            const thread = await client.channels.fetch(threadIdToUse);
            if (thread && (thread.type === ChannelType.PublicThread || thread.type === ChannelType.PrivateThread || thread.type === ChannelType.AnnouncementThread)) {
                finalTargetChannel = thread;
            } else {
                logEvent("warn", "discord_thread_invalid", { threadId: threadIdToUse });
            }
        }

        const isThread = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(finalTargetChannel.type);
        const parentChannel = (isThread && (finalTargetChannel as any).parent) ? (finalTargetChannel as any).parent : finalTargetChannel;

        let webhook = await getWebhookForChannel(parentChannel as any);
        if (!webhook) return;

        const finalThreadId = isThread ? finalTargetChannel.id : threadIdToUse;

        const result = await webhook.send({
            username,
            content: content || (files && files.length > 0 ? "" : undefined),
            avatarURL: input.avatarUrl,
            files: files,
            threadId: finalThreadId,
            wait: true
        } as any);

        const response = result as any;

        if (input.messageId && response) {
            await withDb(async (db) => {
                await db.query(
                    "update chat_messages set external_message_id = $1, external_thread_id = coalesce(external_thread_id, $2), external_provider = 'discord' where id = $3",
                    [response.id, finalThreadId || null, input.messageId]
                );
            });
        }
    } catch (error) {
        logEvent("error", "discord_outbound_relay_failed", { error: String(error) });
        // If webhook fails (e.g. deleted), clear cache for retry next time
        if (input.discordChannelId) webhookCache.delete(input.discordChannelId);

        // Fallback to bot message if webhook fails
        try {
            const channel = await client.channels.fetch(input.discordChannelId);
            if (channel && "send" in channel) {
                await (channel as any).send(`**[Matrix] ${input.authorName}**: ${input.content}`);
            }
        } catch (fallbackError) {
            logEvent("error", "discord_fallback_relay_failed", { error: String(fallbackError) });
        }
    }
}

export async function updateDiscordRelayedMessage(input: {
    serverId: string;
    discordChannelId: string;
    externalMessageId: string;
    content: string;
}) {
    if (!client || !client.isReady()) return;

    try {
        const channel = await client.channels.fetch(input.discordChannelId);
        if (!channel) return;

        const webhook = await getWebhookForChannel(channel as any);
        if (!webhook) return;

        await webhook.editMessage(input.externalMessageId, {
            content: input.content
        });
    } catch (error) {
        logEvent("error", "discord_webhook_update_failed", { error: String(error) });
    }
}

export async function deleteDiscordRelayedMessage(input: {
    serverId: string;
    discordChannelId: string;
    externalMessageId: string;
}) {
    if (!client || !client.isReady()) return;

    try {
        const channel = await client.channels.fetch(input.discordChannelId);
        if (!channel) return;

        const webhook = await getWebhookForChannel(channel as any);
        if (!webhook) return;

        await webhook.deleteMessage(input.externalMessageId);
    } catch (error) {
        logEvent("error", "discord_webhook_delete_failed", { error: String(error) });
    }
}

export async function getDiscordGuildPresence(guildId: string): Promise<Record<string, { username: string, displayName: string, status: string, avatarUrl: string | null }>> {
    if (!client || !client.isReady()) return {};

    const cached = presenceCache.get(guildId);
    if (cached && cached.isSeeded) {
        return cached.data;
    }

    // Fallback: trigger a seed if not already done, but return empty for now to avoid blocking
    // In a real scenario, we might want to wait for the first seed if it's the first ever request.
    seedGuildPresence(guildId).catch(err => console.error(`Lazy seeding failed for guild ${guildId}:`, err));
    return cached?.data ?? {};
}

async function seedGuildPresence(guildId: string) {
    if (!client || !client.isReady()) return;

    try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) return;

        logEvent("info", "discord_presence_seeding_start", { guildId });
        const members = await guild.members.fetch({ withPresences: true });
        const presenceMap: Record<string, { username: string, displayName: string, status: string, avatarUrl: string | null }> = {};

        for (const [id, member] of members) {
            presenceMap[id] = {
                username: member.user.username,
                displayName: member.displayName,
                status: member.presence?.status ?? "offline",
                avatarUrl: member.user.displayAvatarURL()
            };
        }

        presenceCache.set(guildId, {
            data: presenceMap,
            isSeeded: true,
            lastFullSyncAt: Date.now()
        });
        logEvent("info", "discord_presence_seeding_complete", { guildId, memberCount: members.size });
    } catch (error) {
        logEvent("error", "discord_presence_seeding_failed", { guildId, error: String(error) });
    }
}

async function seedPresenceCache() {
    if (!client || !client.isReady()) return;

    // Identify all guilds that have active bridge mappings
    const guildIds = await withDb(async (db) => {
        const rows = await db.query<{ guild_id: string }>(
            "select distinct guild_id from discord_bridge_channel_mappings where enabled = true"
        );
        return rows.rows.map(r => r.guild_id);
    });

    for (const guildId of guildIds) {
        await seedGuildPresence(guildId);
        // Rate limit mitigation for initial burst.
        // Discord allows 120 gateway events per 60 seconds.
        // Large guilds may require multiple chunk requests per fetch.
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
}

function startAntiEntropyLoop() {
    setInterval(async () => {
        if (!client || !client.isReady()) return;

        // Find the guild with the oldest lastFullSyncAt
        let stalestGuildId: string | null = null;
        let oldestSync = Date.now();

        for (const [guildId, cache] of presenceCache.entries()) {
            if (cache.lastFullSyncAt < oldestSync) {
                oldestSync = cache.lastFullSyncAt;
                stalestGuildId = guildId;
            }
        }

        if (stalestGuildId) {
            logEvent("info", "discord_presence_anti_entropy_start", { guildId: stalestGuildId });
            await seedGuildPresence(stalestGuildId);
        }
    }, ANTI_ENTROPY_INTERVAL_MS);
}

export async function kickDiscordMember(guildId: string, discordUserId: string, reason: string) {
    if (!client || !client.isReady()) return;
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(discordUserId);
    if (member) {
        await member.kick(reason);
        logEvent("info", "discord_member_kicked", { guildId, discordUserId, reason });
    }
}

export async function banDiscordMember(guildId: string, discordUserId: string, reason: string) {
    if (!client || !client.isReady()) return;
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return;
    await guild.members.ban(discordUserId, { reason });
    logEvent("info", "discord_member_banned", { guildId, discordUserId, reason });
}

export async function unbanDiscordMember(guildId: string, discordUserId: string, reason: string) {
    if (!client || !client.isReady()) return;
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return;
    await guild.members.unban(discordUserId, reason);
    logEvent("info", "discord_member_unbanned", { guildId, discordUserId, reason });
}

export async function timeoutDiscordMember(guildId: string, discordUserId: string, durationSeconds: number, reason: string) {
    if (!client || !client.isReady()) return;
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(discordUserId);
    if (member) {
        await member.timeout(durationSeconds * 1000, reason);
        logEvent("info", "discord_member_timed_out", { guildId, discordUserId, durationSeconds, reason });
    }
}

export async function fetchDiscordUserProfile(discordUserId: string) {
    if (!client || !client.isReady()) {
        await startDiscordBot();
        if (!client || !client.isReady()) return null;
    }

    try {
        const user = await client.users.fetch(discordUserId);
        return {
            username: user.username,
            displayName: user.globalName ?? user.username,
            avatarUrl: user.displayAvatarURL(),
            bannerUrl: user.bannerURL()
        };
    } catch (error) {
        logEvent("error", "discord_user_fetch_failed", { discordUserId, error: String(error) });
        return null;
    }
}

// Application emojis live on the bot user (up to 2000) and render in any guild
// the bot is in, so a single upload serves every bridged Skerry server.
const APP_EMOJI_SLOT_LIMIT = 2000;
const APP_EMOJI_NAME_MAX = 32;

function sanitizeAppEmojiName(rawName: string): string {
    // Discord names: lowercase letters, digits, underscore; 2-32 chars.
    const sanitized = rawName.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "emoji";
    return sanitized.slice(0, APP_EMOJI_NAME_MAX);
}

function appEmojiNameWithCollisionSuffix(baseName: string, skerryEmojiId: string): string {
    const suffix = `_${skerryEmojiId.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase()}`;
    const trimmed = baseName.slice(0, Math.max(2, APP_EMOJI_NAME_MAX - suffix.length));
    return `${trimmed}${suffix}`;
}

async function getOrMirrorSkerryEmojiToBotApp(skerryEmojiId: string): Promise<{ id: string, name: string } | null> {
    if (!client || !client.isReady() || !client.application) return null;

    return withDb(async (db) => {
        // 1. Check mapping cache (now global to the bot app, not per-server)
        const mappingRow = await db.query<{ discord_emoji_id: string, discord_emoji_name: string }>(
            "select discord_emoji_id, discord_emoji_name from discord_emoji_mappings where skerry_emoji_id = $1",
            [skerryEmojiId]
        );
        if (mappingRow.rows[0]) {
            await db.query("update discord_emoji_mappings set last_used_at = now() where skerry_emoji_id = $1", [skerryEmojiId]);
            return {
                id: mappingRow.rows[0].discord_emoji_id,
                name: mappingRow.rows[0].discord_emoji_name
            };
        }

        // 2. Fetch Skerry emoji info
        const emojiRow = await db.query<{ name: string, url: string }>(
            "select name, url from server_emojis where id = $1",
            [skerryEmojiId]
        );
        if (!emojiRow.rows[0]) return null;

        const { name, url } = emojiRow.rows[0];

        try {
            await ensureAppEmojiSlot();

            const appEmojis = await client!.application!.emojis.fetch();
            const baseName = sanitizeAppEmojiName(name);

            // If we previously uploaded this exact emoji name to the app but the DB
            // mapping was lost, reattach instead of uploading a duplicate.
            const existing = appEmojis.find(e => e.name === baseName);
            if (existing) {
                await db.query(
                    "insert into discord_emoji_mappings (id, skerry_emoji_id, discord_emoji_id, discord_emoji_name, last_used_at) values ($1, $2, $3, $4, now()) on conflict (skerry_emoji_id) do update set discord_emoji_id = excluded.discord_emoji_id, discord_emoji_name = excluded.discord_emoji_name, last_used_at = now()",
                    [`dem_${crypto.randomUUID().replaceAll("-", "")}`, skerryEmojiId, existing.id, existing.name]
                );
                return { id: existing.id, name: existing.name! };
            }

            // 3. Upload to the bot application
            const absoluteUrl = url.startsWith("http") ? url : `${config.appBaseUrl}${url}`;

            let uploadName = baseName;
            let appEmoji;
            try {
                appEmoji = await client!.application!.emojis.create({ attachment: absoluteUrl, name: uploadName });
            } catch (err: any) {
                // Discord rejects duplicate names with code 30018 / "An asset with that filename already exists"
                // (or 50035 validation). Fall back to a name suffixed with the Skerry emoji ID hash.
                const code = err?.code ?? err?.rawError?.code;
                const message = String(err?.message ?? "");
                const looksLikeNameConflict = code === 30018 || /already exists|maximum number/i.test(message);
                if (!looksLikeNameConflict) throw err;

                uploadName = appEmojiNameWithCollisionSuffix(baseName, skerryEmojiId);
                appEmoji = await client!.application!.emojis.create({ attachment: absoluteUrl, name: uploadName });
            }

            await db.query(
                "insert into discord_emoji_mappings (id, skerry_emoji_id, discord_emoji_id, discord_emoji_name, last_used_at) values ($1, $2, $3, $4, now())",
                [`dem_${crypto.randomUUID().replaceAll("-", "")}`, skerryEmojiId, appEmoji.id, appEmoji.name ?? uploadName]
            );

            return { id: appEmoji.id, name: appEmoji.name ?? uploadName };
        } catch (error) {
            logEvent("error", "discord_emoji_mirror_failed", { error: String(error) });
            return null;
        }
    });
}

// Rotate the stalest mirrored Skerry emoji out of the bot application when we
// approach the slot cap. Realistically this almost never fires at 2000 slots,
// but the guard is here for correctness if a deployment grows that large.
async function ensureAppEmojiSlot(): Promise<void> {
    if (!client || !client.isReady() || !client.application) return;
    const appEmojis = await client.application.emojis.fetch();
    if (appEmojis.size < APP_EMOJI_SLOT_LIMIT) return;

    logEvent("info", "discord_app_emoji_slot_rotation", {});

    await withDb(async (db) => {
        const stalest = await db.query<{ id: string, discord_emoji_id: string }>(
            "select id, discord_emoji_id from discord_emoji_mappings order by last_used_at asc limit 1"
        );
        const row = stalest.rows[0];
        if (!row) return;

        try {
            const emoji = appEmojis.get(row.discord_emoji_id);
            if (emoji) await client!.application!.emojis.delete(emoji.id);
        } catch (err) {
            console.warn(`[Discord Bridge] Failed to delete stale app emoji ${row.discord_emoji_id}:`, err);
        }
        await db.query("delete from discord_emoji_mappings where id = $1", [row.id]);
    });
}

/**
 * Mirror an external Discord emoji to the target server, or use natively if possible.
 * Implements LRU rotation if slots are full.
 */
async function getOrMirrorExternalEmoji(serverId: string, guildId: string, externalEmojiId: string, preferredName: string): Promise<{ id: string, name: string, isAnimated: boolean } | null> {
    if (!client || !client.isReady()) return null;

    return withDb(async (db) => {
        // 1. Check discovery registry for metadata
        const seenRow = await db.query<{ name: string, is_animated: boolean }>(
            "select name, is_animated from discord_seen_emojis where id = $1",
            [externalEmojiId]
        );
        const isAnimated = seenRow.rows[0]?.is_animated ?? false;
        const name = seenRow.rows[0]?.name ?? preferredName;

        // 2. Native Check: Is it already in the target guild?
        try {
            const guild = await client!.guilds.fetch(guildId);
            const emojis = await guild.emojis.fetch();
            
            const native = emojis.get(externalEmojiId);
            if (native) {
                return { id: native.id, name: native.name!, isAnimated: native.animated || false };
            }

            // 3. Check Mirroring Cache
            const mirrorRow = await db.query<{ discord_emoji_id: string, discord_emoji_name: string }>(
                "select discord_emoji_id, discord_emoji_name from discord_external_emoji_mirrors where server_id = $1 and external_emoji_id = $2",
                [serverId, externalEmojiId]
            );
            if (mirrorRow.rows[0]) {
                // Update last_used_at for LRU
                await db.query("update discord_external_emoji_mirrors set last_used_at = now() where server_id = $1 and external_emoji_id = $2", [serverId, externalEmojiId]);
                return {
                    id: mirrorRow.rows[0].discord_emoji_id,
                    name: mirrorRow.rows[0].discord_emoji_name,
                    isAnimated
                };
            }

            // 4. Mirroring required. Ensure slot availability.
            await ensureEmojiSlot(guild, serverId);

            const ext = isAnimated ? "gif" : "png";
            const url = `https://cdn.discordapp.com/emojis/${externalEmojiId}.${ext}?size=128&quality=lossless`;

            // Upload to Discord
            const discordEmoji = await guild.emojis.create({
                attachment: url,
                name: name,
                reason: "Mirrored external Discord emoji"
            });

            // Save mapping
            await db.query(
                "insert into discord_external_emoji_mirrors (id, server_id, external_emoji_id, discord_emoji_id, discord_emoji_name, last_used_at) values ($1, $2, $3, $4, $5, now())",
                [`dex_${crypto.randomUUID().replaceAll("-", "")}`, serverId, externalEmojiId, discordEmoji.id, discordEmoji.name]
            );

            return { id: discordEmoji.id, name: discordEmoji.name, isAnimated };
        } catch (error) {
            logEvent("error", "discord_external_emoji_mirror_failed", { error: String(error) });
            return null;
        }
    });
}

/**
 * Handles LRU rotation of mirrored emojis if the guild is at its slot limit.
 */
async function ensureEmojiSlot(guild: Guild, serverId: string): Promise<void> {
    const emojis = await guild.emojis.fetch();
    // Default limit is 50 for non-boosted guilds.
    if (emojis.size < 50) return;

    logEvent("info", "discord_emoji_slot_rotation", { guildId: guild.id });

    await withDb(async (db) => {
        // Skerry-native mirrors moved to bot-application emojis (see
        // ensureAppEmojiSlot); only cross-guild Discord-emoji mirrors still
        // occupy per-guild slots and need rotation here.
        const stalest = await db.query<{ id: string, discord_emoji_id: string }>(
            "select id, discord_emoji_id from discord_external_emoji_mirrors where server_id = $1 order by last_used_at asc limit 1",
            [serverId]
        );
        const row = stalest.rows[0];
        if (!row) return;

        try {
            const emoji = guild.emojis.cache.get(row.discord_emoji_id) || await guild.emojis.fetch(row.discord_emoji_id);
            if (emoji) {
                await emoji.delete("LRU rotation for new mirrored emoji");
            }
        } catch (err) {
            console.warn(`[Discord Bridge] Failed to delete stale emoji ${row.discord_emoji_id}:`, err);
        }
        // If the Discord-side delete failed (maybe already gone), still drop the
        // mapping so we don't keep selecting it as the LRU victim.
        await db.query("delete from discord_external_emoji_mirrors where id = $1", [row.id]);
    });
}

export async function relayMatrixReactionToDiscord(input: {
    serverId: string;
    discordChannelId: string;
    externalMessageId: string;
    emoji: string;
    action: "add" | "remove";
    discordUserId?: string;
}) {
    if (!client || !client.isReady()) return;
    const bot = client;

    try {
        const channel = await bot.channels.fetch(input.discordChannelId);
        if (!channel || !("messages" in channel)) return;

        const message = await (channel as any).messages.fetch(input.externalMessageId);
        if (!message) return;

        if (input.action === "add") {
            await message.react(input.emoji).catch((err: any) => {
                console.warn(`[Discord Bridge] Failed to react with ${input.emoji}:`, err.message);
            });
        } else {
            // Find the reaction by name or ID or toString
            const reaction = message.reactions.cache.find((r: MessageReaction) => 
                r.emoji.name === input.emoji || 
                r.emoji.id === input.emoji || 
                r.emoji.toString() === input.emoji ||
                (input.emoji.includes(":") && input.emoji.split(":").pop()?.replace(">", "") === r.emoji.id)
            );

            if (reaction) {
                const targetId = input.discordUserId || bot.user!.id;
                await reaction.users.remove(targetId).catch((err: any) => {
                    if (err.code === 50013) {
                        console.warn(`[Discord Bridge] Bot lacks "Manage Messages" permission to remove reaction for user ${targetId}. Falling back to removing self.`);
                        if (targetId !== bot.user!.id) {
                            reaction.users.remove(bot.user!.id).catch(() => {});
                        }
                    } else {
                        console.warn(`[Discord Bridge] Failed to remove reaction ${input.emoji} for user ${targetId}:`, err.message);
                    }
                });
            }
        }
    } catch (error) {
        logEvent("error", "discord_reaction_mirror_failed", { error: String(error) });
    }
}

export async function relayMatrixTypingToDiscord(input: {
    serverId: string;
    discordChannelId: string;
    isTyping: boolean;
}) {
    if (!client || !client.isReady()) return;

    try {
        const channel = await client.channels.fetch(input.discordChannelId);
        if (channel && "sendTyping" in channel) {
            const now = Date.now();
            const lastPulse = typingActivity.get(input.discordChannelId) || 0;

            if (input.isTyping) {
                // Only send pulse if it's been more than 9 seconds since last one (Discord timeout is 10s)
                if (now - lastPulse > 9000) {
                    await (channel as any).sendTyping();
                    typingActivity.set(input.discordChannelId, now);
                }
            } else {
                // If we were typing, send a ghost message to clear it
                // We use a 11s window to account for the natural 10s timeout
                if (now - lastPulse < 11000) {
                    typingActivity.delete(input.discordChannelId);
                    
                    // Ghost message: Send a zero-width space and delete it immediately.
                    // We use SuppressNotifications to avoid audible pops.
                    try {
                        const ghostMsg = await (channel as any).send({
                            content: "\u200B",
                            flags: [4096] // MessageFlags.SuppressNotifications
                        });
                        await ghostMsg.delete().catch(() => {});
                    } catch (err) {
                        // Ignore errors if we can't send/delete
                    }
                }
            }
        }
    } catch (error) {
        logEvent("error", "discord_typing_mirror_failed", { error: String(error) });
    }
}

export async function relayMatrixPinToDiscord(input: {
    serverId: string;
    discordChannelId: string;
    externalMessageId: string;
    action: "pin" | "unpin";
}) {
    if (!client || !client.isReady()) return;

    try {
        const channel = await client.channels.fetch(input.discordChannelId);
        if (!channel || !("messages" in channel)) return;

        const message = await (channel as any).messages.fetch(input.externalMessageId);
        if (!message) return;

        if (input.action === "pin") {
            await message.pin();
        } else {
            await message.unpin();
        }
    } catch (error) {
        logEvent("error", "discord_pin_mirror_failed", { error: String(error) });
    }
}
