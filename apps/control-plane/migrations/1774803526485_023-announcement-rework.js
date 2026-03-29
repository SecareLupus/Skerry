export async function up(pgm) {
  // Announcement Rework
  pgm.createTable('followed_announcements', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    product_user_id: { type: 'text', notNull: true },
    source_space_id: { type: 'text', notNull: true }, // server_id
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.addConstraint('followed_announcements', 'unique_user_space_follow', {
    unique: ['product_user_id', 'source_space_id']
  });

  // Optimize message lookups for fans
  pgm.createIndex('followed_announcements', 'product_user_id');
  pgm.createIndex('followed_announcements', 'source_space_id');
}

export async function down(pgm) {
  pgm.dropTable('followed_announcements');
}
