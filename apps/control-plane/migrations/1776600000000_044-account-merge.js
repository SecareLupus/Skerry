export const up = (pgm) => {
    pgm.addColumn('identity_mappings', {
        merged_into_product_user_id: { type: 'text' },
    });
};

export const down = (pgm) => {
    pgm.dropColumn('identity_mappings', 'merged_into_product_user_id');
};
