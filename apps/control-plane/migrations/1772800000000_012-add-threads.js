export const up = (pgm) => {
    pgm.addColumns('chat_messages', {
        parent_id: { type: 'text', references: 'chat_messages', onDelete: 'CASCADE' },
        external_thread_id: { type: 'text' }
    });

    pgm.createIndex('chat_messages', 'parent_id');
    pgm.createIndex('chat_messages', 'external_thread_id');
};

export const down = (pgm) => {
    pgm.dropIndex('chat_messages', 'external_thread_id');
    pgm.dropIndex('chat_messages', 'parent_id');
    pgm.dropColumns('chat_messages', ['parent_id', 'external_thread_id']);
};
