"use client";

import { addReaction, removeReaction } from "../lib/control-plane";

export interface ReactionItem {
  emoji: string;
  count: number;
  me: boolean;
  displayNames?: string[];
}

function ReactionEmoji({ emoji }: { emoji: string }) {
  const customMatch = /^<(a?):([a-zA-Z0-9_-]+):(\d+)>$/.exec(emoji);
  if (customMatch) {
    const animated = customMatch[1] === "a";
    const name = customMatch[2]!;
    const id = customMatch[3]!;
    const ext = animated ? "gif" : "webp";
    return (
      <img
        src={`https://cdn.discordapp.com/emojis/${id}.${ext}?size=32&quality=lossless`}
        alt={`:${name}:`}
        title={`:${name}:`}
        style={{ width: "1.1em", height: "1.1em", verticalAlign: "middle", objectFit: "contain" }}
      />
    );
  }
  return <span>{emoji}</span>;
}

interface ReactionsProps {
  reactions: ReactionItem[] | undefined;
  channelId: string;
  messageId: string;
  onToggle?: (emoji: string, isMe: boolean) => void;
}

export function Reactions({ reactions, channelId, messageId, onToggle }: ReactionsProps) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div
      className="message-reactions-container"
      style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}
    >
      {reactions.map((r) => (
        <button
          key={r.emoji}
          data-testid="reaction-badge"
          title={r.displayNames ? r.displayNames.join(", ") : ""}
          type="button"
          className={`interaction-btn ${r.me ? "active" : ""}`}
          style={{
            padding: "1px 6px",
            borderRadius: "12px",
            fontSize: "0.85rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
          }}
          onClick={() => {
            const emoji = r.emoji;
            const isMe = r.me;

            onToggle?.(emoji, isMe);

            if (isMe) {
              void removeReaction(channelId, messageId, emoji);
            } else {
              void addReaction(channelId, messageId, emoji);
            }
          }}
        >
          <ReactionEmoji emoji={r.emoji} />
          <span style={{ fontWeight: 600, opacity: 0.8 }}>{r.count}</span>
        </button>
      ))}
    </div>
  );
}
