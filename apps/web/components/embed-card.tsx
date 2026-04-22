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

  const getTwitchEmbedUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes("twitch.tv")) return null;
      
      const parent = typeof window !== "undefined" ? window.location.hostname : "";
      
      // Channel: twitch.tv/username
      // VOD: twitch.tv/videos/123
      const parts = urlObj.pathname.split("/").filter(Boolean);
      if (parts[0] === "videos") {
        return `https://player.twitch.tv/?video=${parts[1]}&parent=${parent}&autoplay=true`;
      } else if (parts[0]) {
        return `https://player.twitch.tv/?channel=${parts[0]}&parent=${parent}&autoplay=true`;
      }
    } catch (e) {
      return null;
    }
    return null;
  };

  const getGifEmbedUrl = (url: string) => {
    if (url.includes("tenor.com/view") || url.includes("giphy.com/gifs")) {
        const urlParts = url.split("/");
        const lastPart = urlParts[urlParts.length - 1] || "";
        const lastPartWithoutExt = lastPart.replace(/\.[^.]+$/, "");
        const idMatch = lastPartWithoutExt.match(/-([a-zA-Z0-9]+)$|([a-zA-Z0-9]+)$/);
        const id = idMatch ? (idMatch[1] || idMatch[2]) : lastPartWithoutExt;
        return url.includes("tenor.com") 
            ? `https://tenor.com/embed/${id}`
            : `https://giphy.com/embed/${id}`;
    }
    return null;
  };

  const getVideoEmbedUrl = () => {
    const yt = getYouTubeEmbedUrl(embed.url);
    if (yt) return yt;

    const twitch = getTwitchEmbedUrl(embed.url);
    if (twitch) return twitch;

    const gif = getGifEmbedUrl(embed.url);
    if (gif) return gif;

    // Fallback to og:video if it looks like an embed URL
    if (embed.videoUrl) {
      if (embed.videoUrl.includes("player.") || embed.videoUrl.includes("/embed/")) {
        return embed.videoUrl;
      }
    }

    return null;
  };

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPlaying(true);
  };

  const gifEmbedUrl = getGifEmbedUrl(embed.url);
  const videoEmbedUrl = getVideoEmbedUrl();
  const showVideo = (isPlaying || embed.type === "gif") && (videoEmbedUrl || gifEmbedUrl);

  return (
    <div className="embed-card-container">
      {showVideo ? (
        <div className="embed-video-container">
          <iframe
            src={videoEmbedUrl || gifEmbedUrl || undefined}
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
                  onError={(e) => {
                    // Hide the broken image container
                    const container = e.currentTarget.parentElement;
                    if (container) container.style.display = "none";
                  }}
                />
                {embed.type === "video" && videoEmbedUrl && (
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
