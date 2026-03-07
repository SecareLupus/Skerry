export const up = (pgm) => {
    pgm.addColumns('chat_messages', {
        external_message_id: { type: 'text' }
    });

    pgm.createIndex('chat_messages', ['external_provider', 'external_message_id'], {
        ifNotExists: true,
        where: 'external_message_id IS NOT NULL'
    });
};

export const down = (pgm) => {
    pgm.dropIndex('chat_messages', ['external_provider', 'external_message_id']);
    pgm.dropColumns('chat_messages', ['external_message_id']);
};
