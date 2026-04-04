"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { EmojiClickData } from "emoji-picker-react";

// @ts-ignore - emoji-picker-react types mismatch with Next.js dynamic
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false }) as any;

interface IconPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const isUrl = value.startsWith("http") || value.startsWith("/");
  const [mode, setMode] = useState<"emoji" | "url">(isUrl ? "url" : "emoji");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    if (isPickerOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isPickerOpen]);

  const onEmojiClick = (emojiData: EmojiClickData) => {
    onChange(emojiData.emoji);
    setIsPickerOpen(false);
  };

  const handleModeSwitch = (newMode: "emoji" | "url") => {
    setMode(newMode);
    if (newMode === "emoji") {
      setIsPickerOpen(true);
    } else {
      setIsPickerOpen(false);
    }
  };

  return (
    <div className="icon-picker-container" ref={containerRef}>
      <div className="icon-picker-header">
        <div className="icon-preview-circle">
          {isUrl ? (
            <img src={value} alt="icon" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <span className="emoji-display">{value || "💬"}</span>
          )}
        </div>

        <div className="icon-mode-toggles">
          <button
            type="button"
            className={`mode-toggle-btn ${mode === "emoji" ? "active" : "inactive"}`}
            onClick={() => handleModeSwitch("emoji")}
            title="Emoji"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${mode === "url" ? "active" : "inactive"}`}
            onClick={() => handleModeSwitch("url")}
            title="Image URL"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
        </div>

        {mode === "url" && (
          <div className="url-input-wrapper">
            <input
              type="url"
              className="icon-url-input"
              placeholder="https://image-url..."
              value={isUrl ? value : ""}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
            />
          </div>
        )}
      </div>

      {isPickerOpen && mode === "emoji" && (
        <div className="emoji-popover">
          <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" lazyLoadEmojis={true} />
        </div>
      )}

      <style jsx>{`
        .icon-picker-container {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          width: 100%;
        }
        .icon-picker-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          background: var(--surface-alt);
          padding: 0.75rem;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .icon-preview-circle {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
          font-size: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .icon-preview-circle img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .icon-mode-toggles {
          display: flex;
          gap: 0.5rem;
          padding: 4px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 10px;
        }
        .mode-toggle-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .mode-toggle-btn.active {
          background: var(--surface);
          color: var(--primary);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          opacity: 1;
        }
        .mode-toggle-btn.inactive {
          opacity: 0.4;
        }
        .mode-toggle-btn.inactive:hover {
          opacity: 0.7;
        }
        .url-input-wrapper {
          flex: 1;
          animation: slideIn 0.3s ease-out;
        }
        .icon-url-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 0.85rem;
          color: var(--text);
          outline: none;
        }
        .icon-url-input:focus {
          border-color: var(--primary);
        }
        .emoji-popover {
          position: absolute;
          top: 100%;
          left: 0;
          margin-top: 8px;
          z-index: 1000;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          animation: fadeIn 0.2s ease-out;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
