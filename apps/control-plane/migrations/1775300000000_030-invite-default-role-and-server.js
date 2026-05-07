export const up = (pgm) => {
    pgm.addColumns('hub_invites', {
        default_role: { type: 'text' },
        default_server_id: { type: 'text', references: 'servers', onDelete: 'SET NULL' }
    }, { ifNotExists: true });
};

export const down = (pgm) => {
    pgm.dropColumns('hub_invites', ['default_role', 'default_server_id']);
};
