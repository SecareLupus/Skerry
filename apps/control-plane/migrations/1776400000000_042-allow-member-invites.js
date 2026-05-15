export const up = (pgm) => {
    pgm.addColumn('servers', {
        allow_member_invites: { type: 'boolean', notNull: true, default: false },
    });
};

export const down = (pgm) => {
    pgm.dropColumn('servers', 'allow_member_invites');
};
