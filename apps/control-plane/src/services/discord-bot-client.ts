import { Client, GatewayIntentBits, Events, Message, TextChannel, WebhookClient, ChannelType, Partials, MessageReaction } from "discord.js";
import { config } from "../config.js";
import { relayDiscordMessageToMappedChannel } from "./discord-bridge-service.js";
import { logEvent } from "./observability-service.js";
import { withDb } from "../db/client.js";
import fs from "node:fs";
import path from "node:path";

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
                        ...message.stickers.map(s => ({ url: s.url, sourceUrl: s.url, filename: s.name, isSticker: true })),
                        ...message.embeds.map((e: any) => {
                            let url = e.video?.url || e.image?.url || e.thumbnail?.url;

                            // If it's a Giphy gifv, try to ensure we have the .gif version if possible
                            if (e.data.type === 'gifv' && url && url.includes('giphy.com') && url.endsWith('.mp4')) {
                                url = url.replace('.mp4', '.gif');
                            }

                            return url ? { url, sourceUrl: e.url || url } : null;
                        }).filter(Boolean) as Array<{ url: string; sourceUrl: string }>
                    ];

                    await relayDiscordMessageToMappedChannel({
                        serverId,
                        discordChannelId: message.channel.isThread() ? (message.channel as any).parentId : message.channelId,
                        authorId: message.author.id,
                        authorName: message.member?.displayName ?? message.author.displayName ?? message.author.username,
                        authorAvatarUrl: message.author.displayAvatarURL() ?? undefined,
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
            const emoji = reaction.emoji.name;
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
            const emoji = reaction.emoji.name;
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

export function getDiscordClient() {
    return client;
}

export async function provisionProjectEmoji(guildId: string) {
    if (!client || !client.isReady()) return null;
    try {
        const guild = await client.guilds.fetch(guildId);
        const emojis = await guild.emojis.fetch();
        const existing = emojis.find(e => e.name === "skerry");
        if (existing) return existing;

        const logoPath = path.resolve(process.cwd(), config.discordBridge.projectLogoPath);
        if (!fs.existsSync(logoPath)) {
            logEvent("error", "discord_logo_not_found", { path: logoPath });
            return null;
        }

        const logoData = fs.readFileSync(logoPath);
        const emoji = await guild.emojis.create({
            attachment: logoData,
            name: "skerry",
            reason: "Project logo for Skerry bridge"
        });
        logEvent("info", "discord_emoji_provisioned", { guildId, emojiId: emoji.id });
        return emoji;
    } catch (error) {
        logEvent("error", "discord_emoji_provision_failed", { guildId, error: String(error) });
        return null;
    }
}

async function getWebhookForChannel(channel: any): Promise<WebhookClient | null> {
    let webhook = webhookCache.get(channel.id);
    if (!webhook) {
        console.log(`[Discord Bridge] Fetching webhooks for channel ${channel.id}`);
        try {
            const webhooks = await channel.fetchWebhooks();
            const existing = webhooks.find((wh: any) => wh.name === "Skerry Bridge");

            if (existing) {
                webhook = new WebhookClient({ id: existing.id, token: existing.token! });
            } else {
                console.log(`[Discord Bridge] Creating new webhook for channel ${channel.id}`);
                const created = await channel.createWebhook({
                    name: "Skerry Bridge",
                    reason: "Automated bridge for Skerry community"
                });
                webhook = new WebhookClient({ id: created.id, token: created.token! });
            }
            webhookCache.set(channel.id, webhook);
        } catch (error) {
            console.error(`[Discord Bridge] Failed to fetch/create webhook for channel ${channel.id}:`, error);
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
        console.log(`[Discord Bridge] Relaying message ${input.messageId || "no-id"} to channel ${input.discordChannelId}`);
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
            console.log(`[Discord Bridge] Attempting to resolve externalThreadId for parent chain of ${input.parentId}`);
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
                        console.log(`[Discord Bridge] Resolved thread ID ${input.externalThreadId} from parent ${currentParentId} (depth ${depth})`);
                        break;
                    }
                    currentParentId = row.parent_id!;
                    depth++;
                }
                if (!input.externalThreadId) {
                    console.warn(`[Discord Bridge] Could not find external_thread_id in parent chain of ${input.parentId}`);
                }
            });
        }

        let targetChannel = await client.channels.fetch(input.discordChannelId);
        if (!targetChannel) {
            console.error(`[Discord Bridge] Could not fetch channel ${input.discordChannelId}`);
            return;
        }

        if (!allowedTypes.includes(targetChannel.type as any)) {
            console.warn(`[Discord Bridge] Channel ${input.discordChannelId} has unsupported type ${targetChannel.type}`);
            return;
        }

        const guild = (targetChannel as any).guild;
        const emojis = await (guild as any).emojis.fetch();
        const skerryEmoji = emojis.find((e: any) => e.name === "skerry");

        let content = input.content;

        // --- Emoji Mirroring ---
        if (guild) {
            const skerryEmojiMatches = content.match(/:emo_[a-zA-Z0-9_-]+:/g);
            if (skerryEmojiMatches) {
                for (const match of skerryEmojiMatches) {
                    const skerryEmojiId = match.slice(1, -1); // remove colons
                    const discordEmojiFound = await getOrMirrorEmoji(input.serverId, guild.id, skerryEmojiId);
                    if (discordEmojiFound) {
                        content = content.replace(match, `<:${discordEmojiFound.name}:${discordEmojiFound.id}>`);
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
            console.log(`[Discord Bridge] Creating new thread in Forum room via webhook for impersonation`);

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

            console.log(`[Discord Bridge] Forum Webhook Response:`, JSON.stringify({
                id: response.id,
                channelId: response.channelId,
                threadId: response.thread?.id,
                newThreadId
            }));

            if (input.messageId && newThreadId) {
                await withDb(async (db) => {
                    console.log(`[Discord Bridge] Persisting Forum mapping: Skerry msg ${input.messageId} -> Discord thread ${newThreadId}`);
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
            console.log(`[Discord Bridge] Resolving thread ${threadIdToUse} for forum room`);
            const thread = await client.channels.fetch(threadIdToUse);
            if (thread && (thread.type === ChannelType.PublicThread || thread.type === ChannelType.PrivateThread || thread.type === ChannelType.AnnouncementThread)) {
                finalTargetChannel = thread;
                console.log(`[Discord Bridge] Target redirected to thread ${thread.id}`);
            } else {
                console.warn(`[Discord Bridge] Thread ${threadIdToUse} not found or invalid type`);
            }
        }

        const isThread = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(finalTargetChannel.type);
        const parentChannel = (isThread && (finalTargetChannel as any).parent) ? (finalTargetChannel as any).parent : finalTargetChannel;

        let webhook = await getWebhookForChannel(parentChannel as any);
        if (!webhook) return;

        const finalThreadId = isThread ? finalTargetChannel.id : threadIdToUse;
        console.log(`[Discord Bridge] Sending message to webhook. threadId: ${finalThreadId || "none"}`);

        const result = await webhook.send({
            username,
            content: content || (files && files.length > 0 ? "" : undefined),
            avatarURL: input.avatarUrl,
            files: files,
            threadId: finalThreadId,
            wait: true
        } as any);

        const response = result as any;
        console.log(`[Discord Bridge] Webhook Result (Regular/Reply):`, JSON.stringify({
            id: response.id,
            channelId: response.channelId,
            finalThreadId
        }));

        if (input.messageId && response) {
            await withDb(async (db) => {
                console.log(`[Discord Bridge] Persisting Regular mapping: Skerry msg ${input.messageId} -> Discord msg ${response.id} (thread: ${finalThreadId || 'none'})`);
                await db.query(
                    "update chat_messages set external_message_id = $1, external_thread_id = coalesce(external_thread_id, $2), external_provider = 'discord' where id = $3",
                    [response.id, finalThreadId || null, input.messageId]
                );
            });
        }

        console.log(`[Discord Bridge] Message sent successfully`);
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
            console.error("Discord fallback relay failed:", fallbackError);
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
        console.log(`[Discord Bridge] Updated message ${input.externalMessageId} on Discord`);
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
        console.log(`[Discord Bridge] Deleted message ${input.externalMessageId} on Discord`);
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

async function getOrMirrorEmoji(serverId: string, guildId: string, skerryEmojiId: string): Promise<{ id: string, name: string } | null> {
    if (!client || !client.isReady()) return null;

    return withDb(async (db) => {
        // 1. Check mapping cache
        const mappingRow = await db.query<{ discord_emoji_id: string, discord_emoji_name: string }>(
            "select discord_emoji_id, discord_emoji_name from discord_emoji_mappings where server_id = $1 and skerry_emoji_id = $2",
            [serverId, skerryEmojiId]
        );
        if (mappingRow.rows[0]) {
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
            const guild = await client!.guilds.fetch(guildId);
            const emojis = await guild.emojis.fetch();

            // Check if it's already there but not in our mapping
            const existing = emojis.find(e => e.name === name);
            if (existing) {
                await db.query(
                    "insert into discord_emoji_mappings (id, server_id, skerry_emoji_id, discord_emoji_id, discord_emoji_name) values ($1, $2, $3, $4, $5)",
                    [`dem_${crypto.randomUUID().replaceAll("-", "")}`, serverId, skerryEmojiId, existing.id, existing.name]
                );
                return { id: existing.id, name: existing.name };
            }

            // Check guild limits (simple check, 50 is base)
            if (emojis.size >= 50) return null;

            // 3. Upload to Discord
            const discordEmoji = await guild.emojis.create({
                attachment: url,
                name: name,
                reason: "Mirrored from Skerry"
            });

            // 4. Save mapping
            await db.query(
                "insert into discord_emoji_mappings (id, server_id, skerry_emoji_id, discord_emoji_id, discord_emoji_name) values ($1, $2, $3, $4, $5)",
                [`dem_${crypto.randomUUID().replaceAll("-", "")}`, serverId, skerryEmojiId, discordEmoji.id, discordEmoji.name]
            );

            return { id: discordEmoji.id, name: discordEmoji.name };
        } catch (error) {
            console.error("[Discord Bridge] Failed to mirror emoji:", error);
            return null;
        }
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


