export const up = (pgm) => {
    // 1. Update hubs with suspension fields
    pgm.addColumns('hubs', {
        is_suspended: { type: 'boolean', notNull: true, default: false },
        suspended_at: { type: 'timestamptz' },
        suspension_expires_at: { type: 'timestamptz' },
        unlock_code_hash: { type: 'text' },
    });

    // 2. Update servers with role-based access levels
    pgm.addColumns('servers', {
        hub_admin_access: { type: 'text', notNull: true, default: 'chat' },
        space_member_access: { type: 'text', notNull: true, default: 'chat' },
        hub_member_access: { type: 'text', notNull: true, default: 'chat' },
        visitor_access: { type: 'text', notNull: true, default: 'hidden' },
        auto_join_hub_members: { type: 'boolean', notNull: true, default: true },
    });

    // 3. Update channels with role-based access levels
    pgm.addColumns('channels', {
        hub_admin_access: { type: 'text', notNull: true, default: 'chat' },
        space_member_access: { type: 'text', notNull: true, default: 'chat' },
        hub_member_access: { type: 'text', notNull: true, default: 'chat' },
        visitor_access: { type: 'text', notNull: true, default: 'hidden' },
    });

    // 4. Create badges table
    pgm.createTable('badges', {
        id: { type: 'text', primaryKey: true },
        hub_id: { type: 'text', notNull: true, references: 'hubs', onDelete: 'CASCADE' },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        name: { type: 'text', notNull: true },
        rank: { type: 'integer', notNull: true, default: 0 },
        description: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('badges', ['hub_id', 'server_id']);

    // 5. Create user_badges table
    pgm.createTable('user_badges', {
        product_user_id: { type: 'text', notNull: true },
        badge_id: { type: 'text', notNull: true, references: 'badges', onDelete: 'CASCADE' },
        assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('user_badges', 'unique_user_badge', {
        unique: [['product_user_id', 'badge_id']]
    });

    // 6. Create channel_badge_rules table
    pgm.createTable('channel_badge_rules', {
        id: { type: 'text', primaryKey: true },
        channel_id: { type: 'text', notNull: true, references: 'channels', onDelete: 'CASCADE' },
        badge_id: { type: 'text', notNull: true, references: 'badges', onDelete: 'CASCADE' },
        access_level: { type: 'text' }, // Can be null if badge is purely aesthetic
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('channel_badge_rules', 'unique_channel_badge_rule', {
        unique: [['channel_id', 'badge_id']]
    });

    // 7. Create server_badge_rules table
    pgm.createTable('server_badge_rules', {
        id: { type: 'text', primaryKey: true },
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        badge_id: { type: 'text', notNull: true, references: 'badges', onDelete: 'CASCADE' },
        access_level: { type: 'text' }, // Can be null if badge is purely aesthetic
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('server_badge_rules', 'unique_server_badge_rule', {
        unique: [['server_id', 'badge_id']]
    });

    // 8. Create hub_members table
    pgm.createTable('hub_members', {
        hub_id: { type: 'text', notNull: true, references: 'hubs', onDelete: 'CASCADE' },
        product_user_id: { type: 'text', notNull: true },
        joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('hub_members', 'unique_hub_member', {
        unique: [['hub_id', 'product_user_id']]
    });

    // 9. Create server_members table
    pgm.createTable('server_members', {
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        product_user_id: { type: 'text', notNull: true },
        joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('server_members', 'unique_server_member', {
        unique: [['server_id', 'product_user_id']]
    });
};

export const down = (pgm) => {
    pgm.dropTable('server_members');
    pgm.dropTable('hub_members');
    pgm.dropTable('server_badge_rules');
    pgm.dropTable('channel_badge_rules');
    pgm.dropTable('user_badges');
    pgm.dropTable('badges');
    pgm.dropColumns('channels', ['hub_admin_access', 'space_member_access', 'hub_member_access', 'visitor_access']);
    pgm.dropColumns('servers', ['hub_admin_access', 'space_member_access', 'hub_member_access', 'visitor_access', 'auto_join_hub_members']);
    pgm.dropColumns('hubs', ['is_suspended', 'suspended_at', 'suspension_expires_at', 'unlock_code_hash']);
};
