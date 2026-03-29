export async function up(pgm) {
  // Federation Web-of-Trust
  pgm.createTable('trusted_hubs', {
    hub_url: { type: 'text', primaryKey: true },
    shared_secret: { type: 'text', notNull: true },
    trust_level: { type: 'text', notNull: true, default: 'guest' }, // guest, member, partner
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.createTable('federated_user_cache', {
    federated_id: { type: 'text', primaryKey: true }, // @user:hub.com
    local_proxy_user_id: { type: 'text', notNull: true, unique: true },
    hub_url: { type: 'text', notNull: true, references: 'trusted_hubs' },
    display_name: { type: 'text' },
    avatar_url: { type: 'text' },
    last_seen_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('federated_user_cache', 'hub_url');
}

export async function down(pgm) {
  pgm.dropTable('federated_user_cache');
  pgm.dropTable('trusted_hubs');
}
