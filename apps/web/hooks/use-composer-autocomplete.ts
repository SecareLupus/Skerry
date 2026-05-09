"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import type { ChatMember } from "../context/chat-context";
import { detectActiveTrigger, applyCompletion, type ActiveTrigger } from "../lib/composer-autocomplete/triggers";
import { mentionItems, emojiItems, type AutocompleteItem } from "../lib/composer-autocomplete/providers";

interface UseComposerAutocompleteParams {
  value: string;
  cursorPos: number;
  members: ChatMember[];
  setValue: (next: string) => void;
  setCursorPos: (pos: number) => void;
}

export interface ComposerAutocompleteState {
  items: AutocompleteItem[];
  active: ActiveTrigger | null;
  selectedIdx: number;
  setSelectedIdx: (idx: number) => void;
  selectItem: (item: AutocompleteItem) => void;
  selectActiveItem: () => boolean;
  dismiss: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

export function useComposerAutocomplete({
  value,
  cursorPos,
  members,
  setValue,
  setCursorPos
}: UseComposerAutocompleteParams): ComposerAutocompleteState {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dismissedTrigger, setDismissedTrigger] = useState<string | null>(null);

  const active = useMemo(() => detectActiveTrigger(value, cursorPos), [value, cursorPos]);

  const triggerKey = active ? `${active.kind}@${active.startIdx}` : null;
  const isDismissed = triggerKey !== null && dismissedTrigger === triggerKey;

  const items = useMemo<AutocompleteItem[]>(() => {
    if (!active || isDismissed) return [];
    if (active.kind === "mention") return mentionItems(active.query, members);
    if (active.kind === "emoji") return emojiItems(active.query);
    return [];
  }, [active, members, isDismissed]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [triggerKey, items.length]);

  useEffect(() => {
    if (dismissedTrigger && triggerKey !== dismissedTrigger) {
      setDismissedTrigger(null);
    }
  }, [triggerKey, dismissedTrigger]);

  const selectItem = useCallback(
    (item: AutocompleteItem) => {
      if (!active || item.disabled || !item.insertText) return;
      const { text, cursorPos: nextCursor } = applyCompletion(value, active, item.insertText);
      setValue(text);
      setCursorPos(nextCursor);
    },
    [active, value, setValue, setCursorPos]
  );

  const selectActiveItem = useCallback((): boolean => {
    const item = items[selectedIdx];
    if (!item || item.disabled || !item.insertText) return false;
    selectItem(item);
    return true;
  }, [items, selectedIdx, selectItem]);

  const dismiss = useCallback(() => {
    if (triggerKey) setDismissedTrigger(triggerKey);
  }, [triggerKey]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (items.length === 0) return false;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIdx((idx) => (idx + 1) % items.length);
          return true;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIdx((idx) => (idx - 1 + items.length) % items.length);
          return true;
        case "Enter":
        case "Tab": {
          const handled = selectActiveItem();
          if (handled) {
            e.preventDefault();
            return true;
          }
          return false;
        }
        case "Escape":
          e.preventDefault();
          dismiss();
          return true;
        default:
          return false;
      }
    },
    [items.length, selectActiveItem, dismiss]
  );

  return {
    items,
    active,
    selectedIdx,
    setSelectedIdx,
    selectItem,
    selectActiveItem,
    dismiss,
    handleKeyDown
  };
}
