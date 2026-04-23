"use client";

import React, { useState, useEffect, useRef } from "react";
import { useIntersectionObserver } from "../hooks/use-intersection-observer";

interface GifPlayerProps {
    src: string;
    alt?: string;
    className?: string;
    style?: React.CSSProperties;
    onClick?: () => void;
}

/**
 * A component that renders an image, but falls back to a video if the image fails.
 * This is useful for GIFs proxied from services like Tenor/Giphy which might return MP4.
 */
export function GifPlayer({ src, alt, className, style, onClick }: GifPlayerProps) {
    const [useVideo, setUseVideo] = useState(false);
    const [ref, isVisible] = useIntersectionObserver<HTMLDivElement>({ rootMargin: "200px" });

    // Passive log to test if visibility detection works without pausing
    useEffect(() => {
        if (useVideo && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            console.log(`[GifPlayer Test] ${isVisible ? 'VISIBLE' : 'HIDDEN'} (${Math.round(rect.width)}x${Math.round(rect.height)}): ${src.slice(-30)}`);
        }
    }, [isVisible, useVideo, src]);

    if (useVideo) {
        return (
            <div ref={ref} className={className} style={{ ...style, display: "block", position: "relative" }}>
                <video
                    src={src}
                    style={{ display: "block", objectFit: "contain", width: "100%", height: "100%" }}
                    autoPlay
                    loop
                    muted
                    playsInline
                    onClick={onClick}
                    onError={() => {
                        console.error("GifPlayer: Both image and video failed to load", src);
                    }}
                />
            </div>
        );
    }

    return (
        <img
            src={src}
            alt={alt}
            className={className}
            style={style}
            onClick={onClick}
            onError={() => {
                console.log("GifPlayer: Image failed, trying video fallback", src);
                setUseVideo(true);
            }}
        />
    );
}
