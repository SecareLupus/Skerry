export const up = (pgm) => {
    // 1. Add is_pinned to chat_messages
    pgm.addColumn('chat_messages', {
        is_pinned: { type: 'boolean', notNull: true, default: false }
    }, { ifNotExists: true });

    // 2. Create hub_invites table
    pgm.createTable('hub_invites', {
        id: { type: 'text', primaryKey: true },
        hub_id: { type: 'text', notNull: true, references: 'hubs', onDelete: 'CASCADE' },
        created_by_user_id: { type: 'text', notNull: true },
        expires_at: { type: 'timestamptz' },
        max_uses: { type: 'integer' },
        uses_count: { type: 'integer', notNull: true, default: 0 },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, { ifNotExists: true });
};

export const down = (pgm) => {
    pgm.dropTable('hub_invites');
    pgm.dropColumn('chat_messages', 'is_pinned');
};
