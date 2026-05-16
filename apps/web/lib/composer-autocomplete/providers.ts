import type { ChatMember } from "../../context/chat-context";
import type { TriggerKind } from "./triggers";
import { searchEmojis, type EmojiEntry } from "./emoji-index";

export interface AutocompleteItem {
  key: string;
  kind: TriggerKind;
  primary: string;
  secondary?: string;
  glyph?: string;
  avatarUrl?: string;
  imageUrl?: string;
  insertText: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface CustomEmojiEntry {
  name: string;
  url: string;
}

export function mentionItems(query: string, members: ChatMember[], limit = 8): AutocompleteItem[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const out: AutocompleteItem[] = [];
  const exact: AutocompleteItem[] = [];
  const prefix: AutocompleteItem[] = [];
  const sub: AutocompleteItem[] = [];

  for (const m of members) {
    if (seen.has(m.productUserId)) continue;
    seen.add(m.productUserId);

    const handle = m.displayName;
    const name = m.oidcDisplayName?.toLowerCase() ?? "";
    const handleLc = handle?.toLowerCase() ?? "";

    const matchesEmpty = q.length === 0;
    const matches = matchesEmpty || name.includes(q) || handleLc.includes(q);
    if (!matches) continue;

    const item: AutocompleteItem = {
      key: m.productUserId,
      kind: "mention",
      primary: m.displayName ?? "Unknown",
      secondary: handle ? `@${handle}` : "Bridged user — not yet mentionable",
      avatarUrl: m.avatarUrl,
      insertText: handle ? `@${handle} ` : "",
      disabled: !handle,
      disabledReason: handle ? undefined : "Bridged users cannot be @-mentioned yet"
    };

    if (matchesEmpty) sub.push(item);
    else if (handleLc === q || name === q) exact.push(item);
    else if (handleLc.startsWith(q) || name.startsWith(q)) prefix.push(item);
    else sub.push(item);
  }

  out.push(...exact, ...prefix, ...sub);
  return out.slice(0, limit);
}

export function emojiItems(query: string, limit = 8, customEmojis?: CustomEmojiEntry[]): AutocompleteItem[] {
  const results: AutocompleteItem[] = [];

  // Custom server emojis first
  if (customEmojis && customEmojis.length > 0) {
    const q = query.toLowerCase();
    const matching = customEmojis.filter(e => e.name.toLowerCase().startsWith(q));
    for (const ce of matching) {
      results.push({
        key: `custom:${ce.name}`,
        kind: "emoji" as const,
        primary: `:${ce.name}:`,
        imageUrl: ce.url,
        insertText: `:${ce.name}:`
      });
    }
  }

  // Unicode emojis
  const unicode: EmojiEntry[] = searchEmojis(query, limit - results.length);
  for (const e of unicode) {
    results.push({
      key: e.shortcode,
      kind: "emoji" as const,
      primary: `:${e.shortcode}:`,
      glyph: e.glyph,
      insertText: `:${e.shortcode}:`
    });
  }

  return results.slice(0, limit);
}
