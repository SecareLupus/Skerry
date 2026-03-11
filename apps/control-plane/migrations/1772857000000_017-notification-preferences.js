export const up = (pgm) => {
    // 1. Add notification_preference to channel_read_states
    pgm.addColumn('channel_read_states', {
        notification_preference: { 
            type: 'text', 
            notNull: true, 
            default: 'all' // all, mentions, none
        }
    }, { ifNotExists: true });
};

export const down = (pgm) => {
    pgm.dropColumn('channel_read_states', 'notification_preference');
};
