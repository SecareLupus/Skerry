exports.up = (pgm) => {
  pgm.addColumn("channels", {
    icon_url: { type: "text", notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("channels", "icon_url");
};
