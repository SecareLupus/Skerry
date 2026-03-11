"use client";

import React from "react";
import { LinkEmbed } from "@skerry/shared";

interface EmbedCardProps {
  embed: LinkEmbed;
}

export const EmbedCard: React.FC<EmbedCardProps> = ({ embed }) => {
  return (
    <div className="flex flex-col border border-zinc-700/50 rounded-lg overflow-hidden bg-zinc-900/50 max-w-xl my-2 hover:bg-zinc-900/80 transition-colors group">
      <div className="flex flex-col sm:flex-row">
        {embed.imageUrl && (
          <div className="sm:w-32 sm:h-auto h-48 w-full flex-shrink-0 relative overflow-hidden bg-zinc-800">
            <img 
              src={embed.imageUrl} 
              alt={embed.title || "Preview"} 
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        )}
        <div className="p-3 flex flex-col justify-between overflow-hidden">
          <div className="flex flex-col space-y-1">
            {embed.siteName && (
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                {embed.siteName}
              </span>
            )}
            <a 
              href={embed.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm font-semibold text-blue-400 hover:underline line-clamp-1 decoration-blue-400/30"
            >
              {embed.title || embed.url}
            </a>
            {embed.description && (
              <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed mt-1">
                {embed.description}
              </p>
            )}
          </div>
          <div className="mt-2 flex items-center space-y-0.5">
             <span className="text-[9px] text-zinc-600 truncate">
               {new URL(embed.url).hostname}
             </span>
          </div>
        </div>
      </div>
    </div>
  );
};
