export type TriggerKind = "mention" | "emoji";

export interface ActiveTrigger {
  kind: TriggerKind;
  query: string;
  startIdx: number;
  endIdx: number;
}

const TRIGGER_CHARS: Record<TriggerKind, string> = {
  mention: "@",
  emoji: ":"
};

const QUERY_PATTERNS: Record<TriggerKind, RegExp> = {
  mention: /^[\p{L}\p{N}._-]*$/u,
  emoji: /^[a-z0-9_+-]*$/i
};

export function detectActiveTrigger(text: string, cursorPos: number): ActiveTrigger | null {
  let i = cursorPos - 1;
  while (i >= 0) {
    const ch = text[i]!;
    if (/\s/.test(ch)) return null;

    let kind: TriggerKind | null = null;
    if (ch === TRIGGER_CHARS.mention) kind = "mention";
    else if (ch === TRIGGER_CHARS.emoji) kind = "emoji";

    if (kind) {
      const atWordStart = i === 0 || /\s/.test(text[i - 1]!);
      if (!atWordStart) return null;

      const query = text.slice(i + 1, cursorPos);
      if (!QUERY_PATTERNS[kind].test(query)) return null;

      if (kind === "emoji" && query.length === 0) return null;

      return { kind, query, startIdx: i, endIdx: cursorPos };
    }
    i--;
  }
  return null;
}

export function applyCompletion(
  text: string,
  trigger: ActiveTrigger,
  insertion: string
): { text: string; cursorPos: number } {
  const next = text.slice(0, trigger.startIdx) + insertion + text.slice(trigger.endIdx);
  return { text: next, cursorPos: trigger.startIdx + insertion.length };
}
