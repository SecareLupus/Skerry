"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { EmojiClickData } from "emoji-picker-react";

// @ts-ignore - emoji-picker-react types mismatch with Next.js dynamic
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false }) as any;

interface IconPickerProps {
  value: string;
  onChange: (value: string) => void;
  defaultIcon?: string;
}

export function IconPicker({ value, onChange, defaultIcon = "💬" }: IconPickerProps) {
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
            <span className="emoji-display">{value || defaultIcon}</span>
          )}
        </div>

        <div className="icon-mode-toggles">
          <button
            type="button"
            className={`mode-toggle-btn ${mode === "emoji" ? "active" : "inactive"}`}
            onClick={() => handleModeSwitch("emoji")}
            title="Emoji"
          >
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
          {value && (
            <button
              type="button"
              className="mode-toggle-btn reset-btn"
              onClick={() => onChange("")}
              title="Reset to Default"
            >
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          )}
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
          gap: 1.15rem;
          background: var(--surface-alt);
          padding: 1rem;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .icon-preview-circle {
          width: 56px;
          height: 56px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
          font-size: 1.85rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .icon-preview-circle img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .emoji-display {
          font-weight: 600;
        }
        .icon-mode-toggles {
          display: flex;
          gap: 0.5rem;
          padding: 6px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 14px;
        }
        .mode-toggle-btn {
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          border: none;
          background: transparent;
          color: white;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .mode-toggle-btn.active {
          background: rgba(255, 255, 255, 0.15);
          color: var(--primary);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          transform: translateY(-1px);
        }
        .mode-toggle-btn.inactive {
          opacity: 0.6;
        }
        .mode-toggle-btn.inactive:hover {
          opacity: 1;
          background: rgba(255, 255, 255, 0.05);
          transform: translateY(-1px);
        }
        .reset-btn {
          color: #ff4d4d;
          opacity: 0.8 !important;
        }
        .reset-btn:hover {
          background: rgba(255, 77, 77, 0.15);
          opacity: 1 !important;
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
