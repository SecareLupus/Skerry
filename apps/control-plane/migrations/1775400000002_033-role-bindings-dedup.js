export const up = (pgm) => {
    // Collapse any pre-existing duplicates so the unique index can be created.
    // Duplicate definition: same (product_user_id, role, hub_id, server_id, channel_id)
    // ignoring the synthetic `id`. Keep the earliest row (by created_at, then id).
    pgm.sql(`
        with ranked as (
            select id,
                   row_number() over (
                       partition by product_user_id, role,
                                    coalesce(hub_id, ''),
                                    coalesce(server_id, ''),
                                    coalesce(channel_id, '')
                       order by created_at asc, id asc
                   ) as rn
            from role_bindings
        )
        delete from role_bindings rb
        using ranked
        where rb.id = ranked.id and ranked.rn > 1;
    `);

    // Unique on the natural identity of a binding. Coalesced because Postgres
    // treats NULLs as distinct in unique constraints by default, which would
    // defeat the dedup intent for hub-only or server-only bindings.
    pgm.sql(`
        create unique index if not exists role_bindings_natural_key
        on role_bindings (
            product_user_id,
            role,
            coalesce(hub_id, ''),
            coalesce(server_id, ''),
            coalesce(channel_id, '')
        );
    `);
};

export const down = (pgm) => {
    pgm.sql("drop index if exists role_bindings_natural_key;");
};
