export const up = (pgm) => {
    pgm.addColumn('hubs', {
        default_auto_join_hub_members: { type: 'boolean', notNull: true, default: true },
    });
};

export const down = (pgm) => {
    pgm.dropColumn('hubs', 'default_auto_join_hub_members');
};
