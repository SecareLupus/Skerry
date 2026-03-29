
exports.up = async (db) => {
  await db.query(`
    create table if not exists tracked_streams (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      platform text not null, -- 'twitch', 'youtube', 'custom'
      channel_id text not null,
      display_name text not null,
      is_live boolean not null default false,
      last_live_at timestamptz,
      current_title text,
      current_game text,
      metadata jsonb default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(server_id, platform, channel_id)
    );

    create index if not exists idx_tracked_streams_live on tracked_streams(is_live) where is_live = true;
  `);

  // Add the live category if it doesn't exist (optional, for grouping)
  // Actually, we'll just use a special channel type 'live' if we want, but the house bot is enough.
};

exports.down = async (db) => {
  await db.query("drop table if exists tracked_streams;");
};
