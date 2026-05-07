export const up = (pgm) => {
    pgm.createTable('hub_invite_default_badges', {
        invite_id: { type: 'text', notNull: true, references: 'hub_invites', onDelete: 'CASCADE' },
        badge_id: { type: 'text', notNull: true, references: 'badges', onDelete: 'CASCADE' }
    }, { ifNotExists: true });
    pgm.addConstraint('hub_invite_default_badges', 'unique_invite_badge', {
        unique: [['invite_id', 'badge_id']]
    });
    pgm.createIndex('hub_invite_default_badges', 'invite_id', { ifNotExists: true });
};

export const down = (pgm) => {
    pgm.dropTable('hub_invite_default_badges');
};
