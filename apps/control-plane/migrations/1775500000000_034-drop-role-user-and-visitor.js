// Permissions sprint P1: drop `user` and `visitor` from the Role enum.
// They were tier classifiers derived from membership state, not granted roles.
// `hub_members` and absence-thereof now express what these rows used to mean.
//
// Migration steps:
//
// 1. Backfill `hub_members` for any non-bridged identity that has a
//    `role='user'` binding with a hub scope. Bridged Discord identities
//    (matrix_user_id LIKE '@discord_%') are excluded — the user
//    explicitly required the bridged user lists not be polluted.
//
// 2. Delete every `role='user'` binding. These were always redundant for
//    real users (membership row covers it) and inert for bridged users.
//
// 3. Delete every `role='visitor'` binding. The `permissionMatrix` had
//    these mapped to the empty array — they granted nothing.

export const up = (pgm) => {
    pgm.sql(`
        insert into hub_members (hub_id, product_user_id)
        select distinct rb.hub_id, rb.product_user_id
        from role_bindings rb
        join identity_mappings im on im.product_user_id = rb.product_user_id
        where rb.role = 'user'
          and rb.hub_id is not null
          and (im.matrix_user_id is null or im.matrix_user_id not like '@discord_%')
        on conflict (hub_id, product_user_id) do nothing;
    `);

    pgm.sql("delete from role_bindings where role = 'user';");
    pgm.sql("delete from role_bindings where role = 'visitor';");
};

export const down = (pgm) => {
    // Intentionally not reversing the deletes — the Role type union no
    // longer contains 'user' or 'visitor' as of this migration, so any
    // re-insert would write rows the application can't represent.
    // hub_members rows backfilled in `up` are kept as well; they're
    // semantically correct under either schema.
    pgm.sql("-- no-op: see migration source for rationale");
};
