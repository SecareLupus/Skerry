/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
    pgm.addColumn('channels', {
        style_content: { type: 'text', notNull: false },
    });
};

export const down = (pgm) => {
    pgm.dropColumn('channels', 'style_content');
};
