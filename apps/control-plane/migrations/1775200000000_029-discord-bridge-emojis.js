export const up = (pgm) => {
    // 1. Add LRU tracking to existing mappings
    pgm.addColumn('discord_emoji_mappings', {
        last_used_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
    });

    // 2. Track emojis seen from Discord for discovery
    pgm.createTable('discord_seen_emojis', {
        id: { type: 'text', primaryKey: true }, // Global Discord Emoji ID
        name: { type: 'text', notNull: true },
        is_animated: { type: 'boolean', notNull: true, default: false },
        source_guild_id: { type: 'text' },
        last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
    }, { ifNotExists: true });

    // 3. Track external Discord emojis mirrored to our guilds
    pgm.createTable('discord_external_emoji_mirrors', {
        id: { type: 'text', primaryKey: true },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        external_emoji_id: { type: 'text', notNull: true, references: 'discord_seen_emojis', onDelete: 'CASCADE' },
        discord_emoji_id: { type: 'text', notNull: true }, // ID in the target Discord server
        discord_emoji_name: { type: 'text', notNull: true },
        last_used_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        ifNotExists: true,
        constraints: {
            unique: [['server_id', 'external_emoji_id']]
        }
    });

    pgm.createIndex('discord_emoji_mappings', ['server_id', 'last_used_at']);
    pgm.createIndex('discord_external_emoji_mirrors', ['server_id', 'last_used_at']);
};

export const down = (pgm) => {
    pgm.dropTable('discord_external_emoji_mirrors');
    pgm.dropTable('discord_seen_emojis');
    pgm.dropColumn('discord_emoji_mappings', 'last_used_at');
};
