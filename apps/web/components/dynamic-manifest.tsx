"use client";

import { useEffect, useRef } from "react";
import { useChat } from "../context/chat-context";

/**
 * Updates <link rel="manifest"> dynamically when the user switches
 * servers, so "Add to Home Screen" uses the current server's name
 * and icon instead of the generic Skerry branding.
 */
export function DynamicManifest() {
    const { state } = useChat();
    const { servers, selectedServerId } = state;
    const blobUrlRef = useRef<string | null>(null);

    useEffect(() => {
        const server = servers.find((s) => s.id === selectedServerId);
        const resolvedName = server?.name ?? "Skerry Chat";
        const resolvedShortName = server?.name ?? "Skerry";
        const resolvedIcon = server?.iconUrl ?? "/icons/icon-192x192.png";
        const themeColor = (server?.theme as Record<string, string> | undefined)?.primary ?? "#2d3748";
        const bgColor = "#1a202c";

        const manifest = {
            name: resolvedName,
            short_name: resolvedShortName,
            description: "Skerry Collective Matrix hub",
            start_url: "/",
            display: "standalone" as const,
            background_color: bgColor,
            theme_color: themeColor,
            icons: [
                { src: resolvedIcon, sizes: "192x192", type: "image/png" },
                { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
            ],
        };

        // Revoke previous blob URL to avoid leaks
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
        }

        const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;

        // Update or create the manifest link
        let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
        if (!link) {
            link = document.createElement("link");
            link.rel = "manifest";
            link.crossOrigin = "use-credentials";
            document.head.appendChild(link);
        }
        link.href = url;

        return () => {
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
                blobUrlRef.current = null;
            }
        };
    }, [servers, selectedServerId]);

    return null;
}
