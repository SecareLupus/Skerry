import { Client, GatewayIntentBits, Events, Message, TextChannel, WebhookClient, ChannelType } from "discord.js";
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
    data: Record<string, { username: string, status: string, avatarUrl: string | null }>,
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
                GatewayIntentBits.GuildMembers
            ]
        });

        client.on(Events.MessageCreate, async (message: Message) => {
            if (message.author.bot) return;

            // Find all servers that have a mapping for this Discord channel
            const serverIds = await withDb(async (db) => {
                const rows = await db.query<{ server_id: string }>(
                    "select server_id from discord_bridge_channel_mappings where guild_id = $1 and discord_channel_id = $2 and enabled = true",
                    [message.guildId, message.channelId]
                );
                return rows.rows.map(r => r.server_id);
            });

            if (serverIds.length === 0) return;

            for (const serverId of serverIds) {
                try {
                    const media = [
                        ...message.attachments.map(a => ({ url: a.url, sourceUrl: a.url })),
                        ...message.embeds.map(e => {
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
                        discordChannelId: message.channelId,
                        authorId: message.author.id,
                        authorName: message.author.username,
                        authorAvatarUrl: message.author.displayAvatarURL() ?? undefined,
                        content: message.content,
                        media
                    });
                } catch (error) {
                    logEvent("error", "discord_relay_failed", { serverId, messageId: message.id, error: String(error) });
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
                status: newPresence.status ?? "offline",
                avatarUrl: newPresence.member.user.displayAvatarURL()
            };
        });

        client.on(Events.GuildMemberAdd, (member) => {
            const cache = presenceCache.get(member.guild.id);
            if (!cache) return;
            cache.data[member.id] = {
                username: member.user.username,
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

export function getDiscordBotClient() {
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
            reason: "Project logo for EscapeHatch bridge"
        });
        logEvent("info", "discord_emoji_provisioned", { guildId, emojiId: emoji.id });
        return emoji;
    } catch (error) {
        logEvent("error", "discord_emoji_provision_failed", { guildId, error: String(error) });
        return null;
    }
}

export async function relayMatrixMessageToDiscord(input: {
    serverId: string;
    discordChannelId: string;
    authorName: string;
    content: string;
    avatarUrl?: string; // Optional avatar from Matrix
    attachments?: Array<{ url: string; contentType: string; filename: string }>;
}) {
    if (!client || !client.isReady()) {
        // Try to start the bot if it's not ready
        await startDiscordBot();
        if (!client || !client.isReady()) return;
    }

    try {
        const channel = await client.channels.fetch(input.discordChannelId);
        if (!channel || channel.type !== ChannelType.GuildText) return;

        const textChannel = channel as TextChannel;
        let webhook = webhookCache.get(input.discordChannelId);

        if (!webhook) {
            const webhooks = await textChannel.fetchWebhooks();
            const existing = webhooks.find(wh => wh.name === "EscapeHatch Bridge");

            if (existing) {
                webhook = new WebhookClient({ id: existing.id, token: existing.token! });
            } else {
                const created = await textChannel.createWebhook({
                    name: "EscapeHatch Bridge",
                    reason: "Automated bridge for EscapeHatch community"
                });
                webhook = new WebhookClient({ id: created.id, token: created.token! });
            }
            webhookCache.set(input.discordChannelId, webhook);
        }

        // Send message via webhook for personified appearance
        // Attempt to find the custom emoji if it exists in the guild
        let content = input.content;
        const guild = textChannel.guild;
        const emojis = await guild.emojis.fetch();
        const skerryEmoji = emojis.find(e => e.name === "skerry");

        if (skerryEmoji) {
            content = `${skerryEmoji} ${content}`;
        }

        const files = input.attachments?.map(a => ({
            attachment: a.url,
            name: a.filename
        }));

        await webhook.send({
            username: skerryEmoji ? input.authorName : `${input.authorName} ${config.discordBridge.icon}`,
            content: content || (files && files.length > 0 ? "" : undefined),
            avatarURL: input.avatarUrl,
            files: files
        });
    } catch (error) {
        logEvent("error", "discord_outbound_relay_failed", { error: String(error) });
        // If webhook fails (e.g. deleted), clear cache for retry next time
        webhookCache.delete(input.discordChannelId);

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

export async function getDiscordGuildPresence(guildId: string): Promise<Record<string, { username: string, status: string, avatarUrl: string | null }>> {
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
        const presenceMap: Record<string, { username: string, status: string, avatarUrl: string | null }> = {};

        for (const [id, member] of members) {
            presenceMap[id] = {
                username: member.user.username,
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
