export const up = (pgm) => {
    pgm.addColumn('chat_messages', {
        embeds: { type: 'jsonb', notNull: true, default: '[]' }
    });
};

export const down = (pgm) => {
    pgm.dropColumn('chat_messages', 'embeds');
};
