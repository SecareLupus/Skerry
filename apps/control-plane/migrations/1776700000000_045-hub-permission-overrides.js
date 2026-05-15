export const up = (pgm) => {
    pgm.createTable('hub_permission_overrides', {
        hub_id: { type: 'text', notNull: true, references: 'hubs', onDelete: 'cascade' },
        role: { type: 'text', notNull: true },
        action: { type: 'text', notNull: true },
        allowed: { type: 'boolean', notNull: true },
    });
    pgm.addConstraint('hub_permission_overrides', 'hub_permission_overrides_pk', {
        primaryKey: ['hub_id', 'role', 'action'],
    });
};

export const down = (pgm) => {
    pgm.dropTable('hub_permission_overrides');
};
