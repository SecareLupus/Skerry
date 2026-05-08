// Permissions sprint P2.b: replace the per-resource `*_access` columns
// with a normalized rules table that:
//   - extends the audience-tier ladder to include `space_admin` and
//     `space_moderator` (in addition to the pre-existing `visitor`,
//     `hub_member`, `space_member`, and `hub_admin` audience tiers);
//   - allows future tier additions without further migrations;
//   - backs the upcoming Hub→Space→Room cascade resolution.
//
// Old columns (`hub_admin_access`, `hub_member_access`,
// `space_member_access`, `visitor_access` on both `servers` and
// `channels`) are RETAINED in this migration for safety. The
// application code still recognizes them as a fallback during the
// rollout. A subsequent cleanup migration will drop them once the
// new path has been live for at least one deploy.
//
// Audience tiers used here:
//   - 'visitor'         (no membership row, no granted role)
//   - 'hub_member'      (row in hub_members)
//   - 'space_member'    (row in server_members)
//   - 'space_moderator' (granted role)
//   - 'space_admin'     (granted role; space_owner inherits this)
//   - 'hub_admin'       (granted role; hub_owner inherits this)
//
// `level` uses the existing AccessLevel enum
// (`hidden | locked | read | chat`). The 4-state ladder already
// encodes visibility/read/write ordering, which is sufficient for
// the user-stated requirement. A future migration can widen to a
// per-capability split if needed.

const TIER_TO_LEGACY_COLUMN = [
    { tier: 'visitor',        column: 'visitor_access',        defaultLevel: 'hidden' },
    { tier: 'hub_member',     column: 'hub_member_access',     defaultLevel: 'chat'   },
    { tier: 'space_member',   column: 'space_member_access',   defaultLevel: 'chat'   },
    { tier: 'hub_admin',      column: 'hub_admin_access',      defaultLevel: 'chat'   }
];
// New tiers — no legacy column. Default to 'chat': admins/moderators
// already have full access today via the role-binding system, so
// rows are seeded conservatively to avoid silently revoking access.
const NEW_TIERS = [
    { tier: 'space_admin',     defaultLevel: 'chat' },
    { tier: 'space_moderator', defaultLevel: 'chat' }
];

export const up = (pgm) => {
    // 1. space_access_rules
    pgm.createTable('space_access_rules', {
        server_id: { type: 'text', notNull: true, references: 'servers', onDelete: 'CASCADE' },
        audience_tier: { type: 'text', notNull: true },
        level: { type: 'text', notNull: true },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
    });
    pgm.addConstraint('space_access_rules', 'space_access_rules_pkey', {
        primaryKey: ['server_id', 'audience_tier']
    });
    pgm.addConstraint('space_access_rules', 'space_access_rules_audience_tier_check', {
        check: "audience_tier in ('visitor','hub_member','space_member','space_moderator','space_admin','hub_admin')"
    });
    pgm.addConstraint('space_access_rules', 'space_access_rules_level_check', {
        check: "level in ('hidden','locked','read','chat')"
    });

    // 2. channel_access_rules
    pgm.createTable('channel_access_rules', {
        channel_id: { type: 'text', notNull: true, references: 'channels', onDelete: 'CASCADE' },
        audience_tier: { type: 'text', notNull: true },
        level: { type: 'text', notNull: true },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
    });
    pgm.addConstraint('channel_access_rules', 'channel_access_rules_pkey', {
        primaryKey: ['channel_id', 'audience_tier']
    });
    pgm.addConstraint('channel_access_rules', 'channel_access_rules_audience_tier_check', {
        check: "audience_tier in ('visitor','hub_member','space_member','space_moderator','space_admin','hub_admin')"
    });
    pgm.addConstraint('channel_access_rules', 'channel_access_rules_level_check', {
        check: "level in ('hidden','locked','read','chat')"
    });

    // 3. Backfill space_access_rules from servers' existing columns.
    for (const { tier, column, defaultLevel } of TIER_TO_LEGACY_COLUMN) {
        pgm.sql(`
            insert into space_access_rules (server_id, audience_tier, level)
            select id, '${tier}', coalesce(${column}, '${defaultLevel}')
            from servers
            on conflict (server_id, audience_tier) do nothing;
        `);
    }
    // 3a. Seed new tiers for every server.
    for (const { tier, defaultLevel } of NEW_TIERS) {
        pgm.sql(`
            insert into space_access_rules (server_id, audience_tier, level)
            select id, '${tier}', '${defaultLevel}'
            from servers
            on conflict (server_id, audience_tier) do nothing;
        `);
    }

    // 4. Backfill channel_access_rules from channels' existing columns.
    for (const { tier, column, defaultLevel } of TIER_TO_LEGACY_COLUMN) {
        pgm.sql(`
            insert into channel_access_rules (channel_id, audience_tier, level)
            select id, '${tier}', coalesce(${column}, '${defaultLevel}')
            from channels
            on conflict (channel_id, audience_tier) do nothing;
        `);
    }
    for (const { tier, defaultLevel } of NEW_TIERS) {
        pgm.sql(`
            insert into channel_access_rules (channel_id, audience_tier, level)
            select id, '${tier}', '${defaultLevel}'
            from channels
            on conflict (channel_id, audience_tier) do nothing;
        `);
    }

    pgm.createIndex('space_access_rules', 'server_id');
    pgm.createIndex('channel_access_rules', 'channel_id');

    // 5. Triggers keep legacy `*_access` columns and the rules tables in
    //    sync during the rollout. Every existing create/update path that
    //    writes to the columns (provisioning-service, channel-service
    //    DM creation, settings-service updates, etc.) automatically gets
    //    the corresponding rules-table rows seeded/updated. Once the
    //    legacy columns are dropped (a follow-up cleanup PR), these
    //    triggers can be dropped too and writes will go directly to the
    //    rules tables from application code.
    pgm.sql(`
        create or replace function sync_space_access_rules() returns trigger as $body$
        begin
            insert into space_access_rules (server_id, audience_tier, level) values
                (new.id, 'visitor',         coalesce(new.visitor_access, 'hidden')),
                (new.id, 'hub_member',      coalesce(new.hub_member_access, 'chat')),
                (new.id, 'space_member',    coalesce(new.space_member_access, 'chat')),
                (new.id, 'hub_admin',       coalesce(new.hub_admin_access, 'chat')),
                (new.id, 'space_admin',     'chat'),
                (new.id, 'space_moderator', 'chat')
            on conflict (server_id, audience_tier) do update
                set level = excluded.level, updated_at = now()
                where space_access_rules.audience_tier in
                    ('visitor','hub_member','space_member','hub_admin');
            return new;
        end;
        $body$ language plpgsql;
    `);
    pgm.sql(`
        create trigger servers_sync_access_rules
        after insert or update of visitor_access, hub_member_access, space_member_access, hub_admin_access on servers
        for each row execute function sync_space_access_rules();
    `);

    pgm.sql(`
        create or replace function sync_channel_access_rules() returns trigger as $body$
        begin
            insert into channel_access_rules (channel_id, audience_tier, level) values
                (new.id, 'visitor',         coalesce(new.visitor_access, 'hidden')),
                (new.id, 'hub_member',      coalesce(new.hub_member_access, 'chat')),
                (new.id, 'space_member',    coalesce(new.space_member_access, 'chat')),
                (new.id, 'hub_admin',       coalesce(new.hub_admin_access, 'chat')),
                (new.id, 'space_admin',     'chat'),
                (new.id, 'space_moderator', 'chat')
            on conflict (channel_id, audience_tier) do update
                set level = excluded.level, updated_at = now()
                where channel_access_rules.audience_tier in
                    ('visitor','hub_member','space_member','hub_admin');
            return new;
        end;
        $body$ language plpgsql;
    `);
    pgm.sql(`
        create trigger channels_sync_access_rules
        after insert or update of visitor_access, hub_member_access, space_member_access, hub_admin_access on channels
        for each row execute function sync_channel_access_rules();
    `);
};

export const down = (pgm) => {
    pgm.sql("drop trigger if exists channels_sync_access_rules on channels;");
    pgm.sql("drop trigger if exists servers_sync_access_rules on servers;");
    pgm.sql("drop function if exists sync_channel_access_rules;");
    pgm.sql("drop function if exists sync_space_access_rules;");
    pgm.dropTable('channel_access_rules');
    pgm.dropTable('space_access_rules');
};
