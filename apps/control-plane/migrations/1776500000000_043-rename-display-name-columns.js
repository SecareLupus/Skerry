export const up = (pgm) => {
    // display_name → oidc_display_name FIRST (free up the name)
    pgm.renameColumn('identity_mappings', 'display_name', 'oidc_display_name');
    // preferred_username → display_name (the user-chosen handle, now available)
    pgm.renameColumn('identity_mappings', 'preferred_username', 'display_name');
    // messages.author_display_name stores preferred_username (now display_name),
    // not the OIDC name — it stays as-is.
};

export const down = (pgm) => {
    // display_name → preferred_username FIRST (free up the name)
    pgm.renameColumn('identity_mappings', 'display_name', 'preferred_username');
    // oidc_display_name → display_name (restore OIDC column)
    pgm.renameColumn('identity_mappings', 'oidc_display_name', 'display_name');
};
