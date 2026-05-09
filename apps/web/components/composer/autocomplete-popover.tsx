"use client";

import React from "react";
import type { AutocompleteItem } from "../../lib/composer-autocomplete/providers";

interface Props {
  items: AutocompleteItem[];
  selectedIdx: number;
  onSelect: (item: AutocompleteItem) => void;
  onHover: (idx: number) => void;
}

export function AutocompletePopover({ items, selectedIdx, onSelect, onHover }: Props) {
  if (items.length === 0) return null;
  return (
    <div
      className="autocomplete-popover panel"
      role="listbox"
      aria-label="Autocomplete suggestions"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={idx === selectedIdx}
          className={`autocomplete-item${idx === selectedIdx ? " is-selected" : ""}${item.disabled ? " is-disabled" : ""}`}
          onMouseEnter={() => onHover(idx)}
          onClick={() => !item.disabled && onSelect(item)}
          title={item.disabledReason}
          disabled={item.disabled}
        >
          {item.glyph && <span className="autocomplete-glyph" aria-hidden="true">{item.glyph}</span>}
          {item.avatarUrl && (
            <img className="autocomplete-avatar" src={item.avatarUrl} alt="" aria-hidden="true" />
          )}
          <span className="autocomplete-primary">{item.primary}</span>
          {item.secondary && <span className="autocomplete-secondary">{item.secondary}</span>}
        </button>
      ))}
    </div>
  );
}
