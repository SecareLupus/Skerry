export const up = (pgm) => {
    pgm.createTable('push_subscriptions', {
        id: { type: 'text', primaryKey: true },
        product_user_id: { type: 'text', notNull: true },
        endpoint: { type: 'text', notNull: true, unique: true },
        p256dh_key: { type: 'text', notNull: true },
        auth_key: { type: 'text', notNull: true },
        server_id: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
    });

    pgm.createIndex('push_subscriptions', 'product_user_id');
};

export const down = (pgm) => {
    pgm.dropTable('push_subscriptions');
};
