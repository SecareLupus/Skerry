/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumns('chat_messages', {
    external_author_id: { type: 'text' },
    external_provider: { type: 'text' },
    external_author_name: { type: 'text' },
    external_author_avatar_url: { type: 'text' },
  });

  pgm.createIndex('chat_messages', ['channel_id', 'external_author_id'], {
    ifNotExists: true,
    where: 'external_author_id IS NOT NULL'
  });
};

export const down = (pgm) => {
  pgm.dropIndex('chat_messages', ['channel_id', 'external_author_id']);
  pgm.dropColumns('chat_messages', [
    'external_author_id',
    'external_provider',
    'external_author_name',
    'external_author_avatar_url'
  ]);
};
