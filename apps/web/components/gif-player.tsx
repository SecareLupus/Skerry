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
    // Use a slightly larger margin and ensure it doesn't unmount if it was once visible? 
    // No, let's just make it reliable.
    const [ref, isVisible] = useIntersectionObserver<HTMLDivElement>({ rootMargin: "800px" });

    const containerStyle: React.CSSProperties = {
        ...style,
        display: "block",
        position: "relative",
        minWidth: style?.width || 100,
        minHeight: style?.height || 100,
        background: "rgba(255,255,255,0.02)", // Tiny placeholder background
        borderRadius: 8,
        overflow: "hidden"
    };

    // Passive log to test if visibility detection works without pausing
    useEffect(() => {
        if (useVideo && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            console.log(`[GifPlayer Test] ${isVisible ? 'VISIBLE' : 'HIDDEN'} (${Math.round(rect.width)}x${Math.round(rect.height)}): ${src.slice(-30)}`);
        }
    }, [isVisible, useVideo, src]);

    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            if (isVisible) {
                videoRef.current.play().catch(() => {}); // Ignore abort errors
            } else {
                videoRef.current.pause();
            }
        }
    }, [isVisible]);

    if (useVideo) {
        return (
            <div ref={ref} className={className} style={containerStyle}>
                <video
                    ref={videoRef}
                    src={src}
                    style={{ display: "block", objectFit: "contain", width: "100%", height: "100%" }}
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
