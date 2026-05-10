export const up = (pgm) => {
    pgm.createTable('message_revisions', {
        id: { type: 'text', primaryKey: true },
        message_id: { type: 'text', notNull: true, references: 'chat_messages', onDelete: 'CASCADE' },
        content: { type: 'text', notNull: true },
        editor_user_id: { type: 'text', notNull: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
    });

    pgm.createIndex('message_revisions', 'message_id');
    pgm.createIndex('message_revisions', 'created_at');
};

export const down = (pgm) => {
    pgm.dropTable('message_revisions');
};
