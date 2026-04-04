import { Channel } from "@skerry/shared";

interface MemberLike {
    productUserId: string;
    displayName: string;
}

/**
 * Returns a descriptive name for a channel, handling DM participants and topics.
 * 
 * @param channel The channel object to get the name for
 * @param currentUserId The ID of the current user (to filter them out of DM participant lists)
 * @param fallbackMembers Optional list of members to use if channel.participants is missing
 * @returns A descriptive string for the channel name
 */
export const getChannelName = (channel: Channel, currentUserId?: string, fallbackMembers?: MemberLike[]): string => {
    if (channel.type !== 'dm') {
        return channel.name;
    }

    if (channel.topic) {
        return channel.topic;
    }

    const participants = (channel.participants && channel.participants.length > 0)
        ? channel.participants
        : fallbackMembers;

    if (participants && participants.length > 0) {
        const others = participants.filter(p => p.productUserId !== currentUserId);

        if (others.length === 0) {
            return "Direct Message";
        }

        return others.map(p => p.displayName).join(", ");
    }

    return channel.name;
};
/**
 * Returns the icon for a channel, either custom as defined in iconUrl 
 * or a default based on the channel type.
 */
export const getChannelIcon = (channel: Channel): string => {
    if (channel.iconUrl) {
        return channel.iconUrl;
    }

    switch (channel.type) {
        case 'landing':
            return '🏠';
        case 'voice':
            return '🔊';
        case 'announcement':
            return '📢';
        case 'forum':
            return '🏛️';
        case 'dm':
            return '👤';
        default:
            return '#';
    }
};
