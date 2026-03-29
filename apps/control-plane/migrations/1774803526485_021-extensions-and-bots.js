export const up = (pgm) => {
    // 1. server_emojis
    pgm.createTable('server_emojis', {
        id: { type: 'text', primaryKey: true },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        name: { type: 'text', notNull: true },
        url: { type: 'text', notNull: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        ifNotExists: true,
        constraints: {
            unique: [['server_id', 'name']]
        }
    });

    // 2. server_stickers
    pgm.createTable('server_stickers', {
        id: { type: 'text', primaryKey: true },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        name: { type: 'text', notNull: true },
        url: { type: 'text', notNull: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        ifNotExists: true
    });

    // 3. webhooks
    pgm.createTable('webhooks', {
        id: { type: 'text', primaryKey: true },
        channel_id: { type: 'text', notNull: true, references: 'channels', onDelete: 'CASCADE' },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        name: { type: 'text', notNull: true },
        avatar_url: { type: 'text' },
        secret_token: { type: 'text', notNull: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, { ifNotExists: true });

    // 4. user_stats (Engagement)
    pgm.createTable('user_stats', {
        product_user_id: { type: 'text', notNull: true, primaryKey: true },
        server_id: { type: 'text', notNull: true, primaryKey: true, references: 'servers', onDelete: 'CASCADE' },
        points: { type: 'bigint', notNull: true, default: 0 },
        level: { type: 'integer', notNull: true, default: 1 },
        last_active_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, { ifNotExists: true });

    // 5. house_bot_settings
    pgm.createTable('house_bot_settings', {
        server_id: { type: 'text', primaryKey: true, references: 'servers', onDelete: 'CASCADE' },
        enabled: { type: 'boolean', notNull: true, default: false },
        greeting_enabled: { type: 'boolean', notNull: true, default: false },
        greeting_message: { type: 'text' },
        greeting_channel_id: { type: 'text', references: 'channels', onDelete: 'SET NULL' },
        engagement_enabled: { type: 'boolean', notNull: true, default: false },
        live_notifications_enabled: { type: 'boolean', notNull: true, default: false },
        live_notifications_channel_id: { type: 'text', references: 'channels', onDelete: 'SET NULL' },
        llm_enabled: { type: 'boolean', notNull: true, default: false },
        llm_config: { type: 'jsonb', notNull: true, default: '{}' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, { ifNotExists: true });
    
    // 6. discord_emoji_mappings (for mirroring cache)
    pgm.createTable('discord_emoji_mappings', {
        id: { type: 'text', primaryKey: true },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        skerry_emoji_id: { type: 'text', notNull: true, references: 'server_emojis', onDelete: 'CASCADE' },
        discord_emoji_id: { type: 'text', notNull: true },
        discord_emoji_name: { type: 'text', notNull: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        ifNotExists: true,
        constraints: {
            unique: [['server_id', 'skerry_emoji_id']]
        }
    });
};

export const down = (pgm) => {
    pgm.dropTable('discord_emoji_mappings');
    pgm.dropTable('house_bot_settings');
    pgm.dropTable('user_stats');
    pgm.dropTable('webhooks');
    pgm.dropTable('server_stickers');
    pgm.dropTable('server_emojis');
};
