"use client";

import React, { useMemo } from "react";
import { useChat } from "../context/chat-context";
import type { Hub, Server } from "@skerry/shared";

interface ThemeEngineProps {
    hub?: Hub;
    server?: Server;
    scopeSelector?: string;
}

/**
 * ThemeEngine handles the hierarchical CSS variable injection.
 * Priority: Default (globals.css) < Hub < Server
 */
export function ThemeEngine({ hub, server, scopeSelector }: ThemeEngineProps) {
    const { state } = useChat();
    const activeHub = hub || state.hubs.find(h => h.id === server?.hubId) || state.hubs[0];
    const activeServer = server || state.servers.find(s => s.id === state.selectedServerId);

    const cssVariables = useMemo(() => {
        const vars: Record<string, string> = {};

        // 1. Hub Theme
        if (activeHub?.theme) {
            Object.entries(activeHub.theme).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    // Map common keys to Skerry tokens if they don't start with --
                    const cssKey = key.startsWith('--') ? key : `--sk-${key}`;
                    vars[cssKey] = value;
                }
            });
        }

        // 2. Server (Space) Theme - Only if Hub allows it
        if (activeHub?.allowSpaceCustomization !== false && activeServer?.theme) {
            Object.entries(activeServer.theme).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    const cssKey = key.startsWith('--') ? key : `--sk-${key}`;
                    vars[cssKey] = value;
                }
            });
        }

        return vars;
    }, [activeHub, activeServer]);

    const styleContent = useMemo(() => {
        if (Object.keys(cssVariables).length === 0) return "";

        const decls = Object.entries(cssVariables)
            .map(([k, v]) => `  ${k}: ${v} !important;`)
            .join("\n");

        const selector = scopeSelector || ':root, [data-theme="dark"]';

        return `
            ${selector} {
            ${decls}
            }
        `;
    }, [cssVariables, scopeSelector]);

    if (!styleContent) return null;

    return <style dangerouslySetInnerHTML={{ __html: styleContent }} />;
}
