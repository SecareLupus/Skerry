export const up = (pgm) => {
  pgm.addColumn("channel_read_states", {
    is_muted: { type: "boolean", default: false, notNull: true },
  }, { ifNotExists: true });
};

export const down = (pgm) => {
  pgm.dropColumn("channel_read_states", "is_muted");
};
