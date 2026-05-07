export const up = (pgm) => {
    pgm.addColumn('hub_invites', {
        revoked_at: { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.createIndex('hub_invites', ['hub_id'], {
        name: 'hub_invites_active_by_hub',
        where: 'revoked_at is null',
        ifNotExists: true
    });
};

export const down = (pgm) => {
    pgm.dropIndex('hub_invites', ['hub_id'], { name: 'hub_invites_active_by_hub' });
    pgm.dropColumn('hub_invites', 'revoked_at');
};
