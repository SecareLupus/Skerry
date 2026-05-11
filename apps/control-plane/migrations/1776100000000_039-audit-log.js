export const up = (pgm) => {
    pgm.createTable('audit_log', {
        id: { type: 'text', primaryKey: true },
        server_id: { type: 'text', notNull: true },
        actor_user_id: { type: 'text', notNull: true },
        action_type: { type: 'text', notNull: true },
        target_type: { type: 'text', notNull: true },
        target_id: { type: 'text', notNull: true },
        before_snapshot: { type: 'jsonb' },
        after_snapshot: { type: 'jsonb' },
        metadata: { type: 'jsonb' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
    });

    pgm.createIndex('audit_log', 'server_id');
    pgm.createIndex('audit_log', 'actor_user_id');
    pgm.createIndex('audit_log', 'target_id');
    pgm.createIndex('audit_log', 'action_type');
    pgm.createIndex('audit_log', 'created_at');
};

export const down = (pgm) => {
    pgm.dropTable('audit_log');
};
