// Permissions sprint P2.cleanup: drop the legacy `*_access` columns
// and the sync triggers/functions installed by migration 036.
//
// P2.b kept the columns in place behind a DB trigger so legacy
// write paths continued to work during the rollout. After P2.b
// deployed and proved stable, all code paths now read from
// `space_access_rules` / `channel_access_rules` directly. This
// migration removes the legacy shape entirely.
//
// Order:
//   1. Drop triggers (so subsequent column drops don't fire them).
//   2. Drop functions.
//   3. Drop columns.
//
// `down` re-creates the columns with their previous defaults but
// does NOT re-install the triggers — rolling back P2.cleanup
// requires manually re-applying migration 036's trigger SQL or
// dropping migration 036 first.

export const up = (pgm) => {
    pgm.sql("drop trigger if exists channels_sync_access_rules on channels;");
    pgm.sql("drop trigger if exists servers_sync_access_rules on servers;");
    pgm.sql("drop function if exists sync_channel_access_rules;");
    pgm.sql("drop function if exists sync_space_access_rules;");

    pgm.dropColumns('servers', [
        'hub_admin_access',
        'space_member_access',
        'hub_member_access',
        'visitor_access'
    ]);
    pgm.dropColumns('channels', [
        'hub_admin_access',
        'space_member_access',
        'hub_member_access',
        'visitor_access'
    ]);
};

export const down = (pgm) => {
    pgm.addColumns('servers', {
        hub_admin_access: { type: 'text', notNull: true, default: 'chat' },
        space_member_access: { type: 'text', notNull: true, default: 'chat' },
        hub_member_access: { type: 'text', notNull: true, default: 'chat' },
        visitor_access: { type: 'text', notNull: true, default: 'hidden' }
    });
    pgm.addColumns('channels', {
        hub_admin_access: { type: 'text', notNull: true, default: 'chat' },
        space_member_access: { type: 'text', notNull: true, default: 'chat' },
        hub_member_access: { type: 'text', notNull: true, default: 'chat' },
        visitor_access: { type: 'text', notNull: true, default: 'hidden' }
    });
    // Backfill columns from rules table so the rolled-back code can
    // read meaningful values.
    pgm.sql(`
        update servers set
            visitor_access      = coalesce((select level from space_access_rules where server_id = servers.id and audience_tier = 'visitor'), 'hidden'),
            hub_member_access   = coalesce((select level from space_access_rules where server_id = servers.id and audience_tier = 'hub_member'), 'chat'),
            space_member_access = coalesce((select level from space_access_rules where server_id = servers.id and audience_tier = 'space_member'), 'chat'),
            hub_admin_access    = coalesce((select level from space_access_rules where server_id = servers.id and audience_tier = 'hub_admin'), 'chat');
    `);
    pgm.sql(`
        update channels set
            visitor_access      = coalesce((select level from channel_access_rules where channel_id = channels.id and audience_tier = 'visitor'), 'hidden'),
            hub_member_access   = coalesce((select level from channel_access_rules where channel_id = channels.id and audience_tier = 'hub_member'), 'chat'),
            space_member_access = coalesce((select level from channel_access_rules where channel_id = channels.id and audience_tier = 'space_member'), 'chat'),
            hub_admin_access    = coalesce((select level from channel_access_rules where channel_id = channels.id and audience_tier = 'hub_admin'), 'chat');
    `);
};
