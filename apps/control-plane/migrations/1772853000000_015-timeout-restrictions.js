export const up = (pgm) => {
    pgm.createTable('moderation_time_restrictions', {
        id: { type: 'text', primaryKey: true },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        target_user_id: { type: 'text', notNull: true },
        status: { type: 'text', notNull: true, default: 'active' },
        expires_at: { type: 'timestamptz', notNull: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, { ifNotExists: true });

    pgm.createIndex('moderation_time_restrictions', ['status', 'expires_at']);
};

export const down = (pgm) => {
    pgm.dropTable('moderation_time_restrictions');
};
