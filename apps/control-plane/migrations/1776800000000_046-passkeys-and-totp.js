export const up = (pgm) => {
    pgm.createTable('webauthn_credentials', {
        id: { type: 'text', notNull: true, primaryKey: true },
        hub_id: { type: 'text', notNull: true, references: 'hubs', onDelete: 'cascade' },
        product_user_id: { type: 'text', notNull: true },
        credential_id: { type: 'text', notNull: true, unique: true },
        public_key: { type: 'text', notNull: true },
        sign_count: { type: 'integer', notNull: true, default: 0 },
        label: { type: 'text' },
        has_pin: { type: 'boolean', notNull: true, default: false },
        pin_hash: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        last_used_at: { type: 'timestamptz' },
    });

    pgm.createTable('totp_secrets', {
        hub_id: { type: 'text', notNull: true, references: 'hubs', onDelete: 'cascade' },
        product_user_id: { type: 'text', notNull: true },
        secret: { type: 'text', notNull: true },
        enabled: { type: 'boolean', notNull: true, default: false },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('totp_secrets', 'totp_secrets_pk', {
        primaryKey: ['hub_id', 'product_user_id'],
    });

    pgm.createTable('recovery_codes', {
        id: { type: 'text', primaryKey: true },
        hub_id: { type: 'text', notNull: true, references: 'hubs', onDelete: 'cascade' },
        product_user_id: { type: 'text', notNull: true },
        code_hash: { type: 'text', notNull: true },
        used_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.addColumn('hubs', {
        allow_passkey_login: { type: 'boolean', notNull: true, default: false },
    });

    pgm.addColumn('hub_permission_overrides', {
        require_2fa: { type: 'boolean', notNull: true, default: false },
    });
};

export const down = (pgm) => {
    pgm.dropColumn('hub_permission_overrides', 'require_2fa');
    pgm.dropColumn('hubs', 'allow_passkey_login');
    pgm.dropTable('recovery_codes');
    pgm.dropTable('totp_secrets');
    pgm.dropTable('webauthn_credentials');
};
