// The data source is emoji-picker-react's bundled English locale JSON. Importing
// from `dist/data/...` is a deep import that may break across major version
// upgrades of emoji-picker-react — if that happens, swap in `node-emoji` or
// `@emoji-mart/data` here.
import emojiData from "emoji-picker-react/dist/data/emojis-en.json";

export interface EmojiEntry {
  shortcode: string;
  glyph: string;
  keywords: string[];
}

interface RawEmoji {
  n: string[];
  u: string;
  a: string;
}

interface RawEmojiData {
  emojis: Record<string, RawEmoji[]>;
}

let cache: { entries: EmojiEntry[]; shortcodeToGlyph: Map<string, string> } | null = null;

function codepointToGlyph(hex: string): string {
  return hex
    .split("-")
    .map((p) => String.fromCodePoint(parseInt(p, 16)))
    .join("");
}

function canonicalToShortcode(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Overrides for emoji-picker-react canonical names that differ from
// cross-compatible shortcode names (Discord, Twitch, GitHub, etc.).
const CANONICAL_OVERRIDES: Record<string, string> = {
  mexican: "taco",
  face: "fox"
};

// Compact aliases preserved from the legacy chat-window shortcode map so users
// who already type :smile:/:heart:/etc. still get glyphs after the rename.
const LEGACY_ALIASES: Record<string, string> = {
  smile: "🙂",
  smiley: "😃",
  grinning: "😀",
  blush: "😊",
  wink: "😉",
  heart: "❤️",
  thumbsup: "👍",
  ok_hand: "👌",
  fire: "🔥",
  rocket: "🚀"
};

function buildIndex(): { entries: EmojiEntry[]; shortcodeToGlyph: Map<string, string> } {
  const entries: EmojiEntry[] = [];
  const shortcodeToGlyph = new Map<string, string>();

  for (const [, list] of Object.entries((emojiData as RawEmojiData).emojis)) {
    for (const raw of list) {
      // n[last] is emoji-picker-react's canonical name. Correct most
      // emojis, but some (🌮→"mexican", 🦊→"face") need overrides.
      let canonical = raw.n[raw.n.length - 1];
      if (!canonical) continue;
      let shortcode = canonicalToShortcode(canonical);
      if (CANONICAL_OVERRIDES[shortcode]) shortcode = CANONICAL_OVERRIDES[shortcode]!;
      if (!shortcode) continue;
      const glyph = codepointToGlyph(raw.u);
      const keywords = raw.n.slice(0, -1).map((k) => k.toLowerCase());
      entries.push({ shortcode, glyph, keywords });
      if (!shortcodeToGlyph.has(shortcode)) shortcodeToGlyph.set(shortcode, glyph);
    }
  }

  for (const [alias, glyph] of Object.entries(LEGACY_ALIASES)) {
    if (!shortcodeToGlyph.has(alias)) shortcodeToGlyph.set(alias, glyph);
  }

  return { entries, shortcodeToGlyph };
}

function getIndex() {
  if (!cache) cache = buildIndex();
  return cache;
}

export function searchEmojis(query: string, limit = 8): EmojiEntry[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const { entries } = getIndex();

  const exact: EmojiEntry[] = [];
  const prefix: EmojiEntry[] = [];
  const sub: EmojiEntry[] = [];

  for (const entry of entries) {
    if (entry.shortcode === q) exact.push(entry);
    else if (entry.shortcode.startsWith(q)) prefix.push(entry);
    else if (entry.shortcode.includes(q) || entry.keywords.some((k) => k.includes(q))) sub.push(entry);
    if (exact.length + prefix.length + sub.length >= limit * 3) break;
  }

  return [...exact, ...prefix, ...sub].slice(0, limit);
}

export function shortcodeToGlyph(shortcode: string): string | null {
  const { shortcodeToGlyph: map } = getIndex();
  return map.get(shortcode) ?? null;
}
