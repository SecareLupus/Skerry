export const up = (pgm) => {
  // 1. user_presence table
  pgm.createTable('user_presence', {
    product_user_id: { type: 'text', primaryKey: true, references: 'identity_mappings(product_user_id)', onDelete: 'CASCADE' },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  // 2. Indexes for efficient member listing
  pgm.createIndex('role_bindings', 'server_id', { ifNotExists: true });
  pgm.createIndex('role_bindings', 'channel_id', { ifNotExists: true });
  pgm.createIndex('role_bindings', 'product_user_id', { ifNotExists: true });
};

export const down = (pgm) => {
  pgm.dropIndex('role_bindings', 'product_user_id');
  pgm.dropIndex('role_bindings', 'channel_id');
  pgm.dropIndex('role_bindings', 'server_id');
  pgm.dropTable('user_presence');
};
