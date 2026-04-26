// Migrate Skerry-native -> Discord emoji mirrors from per-guild storage (50 slot
// cap per server) to bot-application-level storage (2000 slot cap, usable across
// every guild the bot is in). Cross-guild Discord-emoji mirrors
// (`discord_external_emoji_mirrors`) stay per-guild and are not touched here.
//
// Existing rows reference emojis we uploaded into individual guilds; the new
// code path uses `client.application.emojis` and won't reference those IDs.
// Truncating is safe — the bot re-mirrors on demand on the next outbound
// relay that needs a Skerry emoji.

export const up = (pgm) => {
    pgm.sql('truncate table discord_emoji_mappings');

    pgm.dropConstraint('discord_emoji_mappings', 'discord_emoji_mappings_server_id_skerry_emoji_id_key', { ifExists: true });
    pgm.dropIndex('discord_emoji_mappings', ['server_id', 'last_used_at'], { ifExists: true });
    pgm.dropColumn('discord_emoji_mappings', 'server_id');

    pgm.addConstraint('discord_emoji_mappings', 'discord_emoji_mappings_skerry_emoji_id_key', {
        unique: ['skerry_emoji_id']
    });
    pgm.createIndex('discord_emoji_mappings', ['last_used_at']);
};

export const down = (pgm) => {
    pgm.sql('truncate table discord_emoji_mappings');

    pgm.dropIndex('discord_emoji_mappings', ['last_used_at'], { ifExists: true });
    pgm.dropConstraint('discord_emoji_mappings', 'discord_emoji_mappings_skerry_emoji_id_key', { ifExists: true });

    pgm.addColumn('discord_emoji_mappings', {
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' }
    });
    pgm.addConstraint('discord_emoji_mappings', 'discord_emoji_mappings_server_id_skerry_emoji_id_key', {
        unique: ['server_id', 'skerry_emoji_id']
    });
    pgm.createIndex('discord_emoji_mappings', ['server_id', 'last_used_at']);
};
