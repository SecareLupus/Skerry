// Permissions sprint P3: default Space Owner = Hub.
//
// Until now `servers.owner_user_id` was NOT NULL — every space had to
// have a single named human owner. Per the user's framing for the
// permissions sprint, the default ownership for a new space should
// instead be "owned by the hub itself" (i.e. any hub manager can
// manage), and naming a specific human as the owner is an explicit
// opt-in.
//
// This migration relaxes the NOT NULL constraint. It does NOT touch
// existing rows — every space currently in the database keeps its
// human owner. The application code interprets `null` as
// hub-owned going forward.

export const up = (pgm) => {
    pgm.alterColumn('servers', 'owner_user_id', { notNull: false });
};

export const down = (pgm) => {
    // Reversing the relaxation requires every server to have an owner.
    // Rather than guessing a default user id, we surface it as a
    // deliberate manual step.
    pgm.sql(`
        do $$
        begin
            if exists (select 1 from servers where owner_user_id is null) then
                raise exception 'Cannot reverse 035: % servers have null owner_user_id; assign owners before rolling back.',
                    (select count(*) from servers where owner_user_id is null);
            end if;
        end$$;
    `);
    pgm.alterColumn('servers', 'owner_user_id', { notNull: true });
};
