"use client";

import React from "react";
import { LinkEmbed } from "@skerry/shared";

interface EmbedCardProps {
  embed: LinkEmbed;
}

export const EmbedCard: React.FC<EmbedCardProps> = ({ embed }) => {
  return (
    <div className="embed-card">
      <div className="embed-grid">
        {embed.imageUrl && (
          <div className="embed-image-container">
            <img 
              src={embed.imageUrl} 
              alt={embed.title || "Preview"} 
              className="embed-image"
              loading="lazy"
            />
            {embed.type === "video" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "rgba(0,0,0,0.6)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="embed-content">
          <div className="flex flex-col">
            {embed.siteName && (
              <span className="embed-site-name">
                {embed.siteName}
              </span>
            )}
            <a 
              href={embed.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="embed-title"
            >
              {embed.title || embed.url}
            </a>
            {embed.description && (
              <p className="embed-description">
                {embed.description}
              </p>
            )}
          </div>
          <div className="embed-footer">
            <span>{new URL(embed.url).hostname}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
