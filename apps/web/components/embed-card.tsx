import React, { useState } from "react";
import { LinkEmbed } from "@skerry/shared";

interface EmbedCardProps {
  embed: LinkEmbed;
}

export const EmbedCard: React.FC<EmbedCardProps> = ({ embed }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  const getYouTubeEmbedUrl = (url: string) => {
    let videoId = "";
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === "youtu.be") {
        videoId = urlObj.pathname.slice(1);
      } else if (urlObj.hostname.includes("youtube.com")) {
        videoId = urlObj.searchParams.get("v") || "";
        if (!videoId && urlObj.pathname.startsWith("/embed/")) {
          videoId = urlObj.pathname.split("/")[2] || "";
        }
      }
    } catch (e) {
      return null;
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1` : null;
  };

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPlaying(true);
  };

  const youtubeEmbedUrl = getYouTubeEmbedUrl(embed.url);

  return (
    <div className="embed-card-container">
      {isPlaying && youtubeEmbedUrl ? (
        <div className="embed-video-container">
          <iframe
            src={youtubeEmbedUrl}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <a 
          href={embed.url} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="embed-card"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div className="embed-grid">
            {embed.imageUrl && (
              <div className="embed-image-container">
                <img 
                  src={embed.imageUrl} 
                  alt={embed.title || "Preview"} 
                  className="embed-image"
                  loading="lazy"
                />
                {embed.type === "video" && youtubeEmbedUrl && (
                  <div className="embed-video-overlay" onClick={handlePlay}>
                    <div className="embed-play-button">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
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
                <span className="embed-title">
                  {embed.title || embed.url}
                </span>
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
        </a>
      )}
    </div>
  );
};
