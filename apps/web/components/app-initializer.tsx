"use client";

import React, { useEffect, useCallback, useRef } from "react";
import { useChat } from "../context/chat-context";
import { useTheme } from "../hooks/use-theme";
import {
    fetchAuthProviders,
    fetchViewerSession,
    fetchBootstrapStatus,
    listViewerRoleBindings,
    listHubs,
    listServers
} from "../lib/control-plane";

export function AppInitializer({ children }: { children: React.ReactNode }) {
    const { dispatch } = useChat();
    const initializedRef = useRef(false);
    
    // Initialize global theme management
    useTheme();

    const refreshGlobalState = useCallback(async (): Promise<void> => {
        try {
            console.log("[AppInitializer] Refreshing global state...");
            const [providers, viewer, bootstrap, roles, hubs, servers] = await Promise.all([
                fetchAuthProviders().catch(() => null),
                fetchViewerSession().catch(() => null),
                fetchBootstrapStatus().catch(() => null),
                listViewerRoleBindings().catch(() => []),
                listHubs().catch(() => []),
                listServers().catch(() => [])
            ]);

            console.log(`[AppInitializer] State fetched: viewer=${viewer?.productUserId || 'none'}, roles=${roles.length}, bootstrap=${bootstrap?.initialized}`);
            if (roles.length > 0) {
                console.log("[AppInitializer] Current Roles:", roles.map(r => `${r.role}@${r.serverId || 'global'}`).join(', '));
            }

            if (providers) dispatch({ type: "SET_PROVIDERS", payload: providers });
            if (viewer) dispatch({ type: "SET_VIEWER", payload: viewer });
            if (bootstrap) dispatch({ type: "SET_BOOTSTRAP_STATUS", payload: bootstrap });
            dispatch({ type: "SET_VIEWER_ROLES", payload: roles });
            dispatch({ type: "SET_HUBS", payload: hubs });
            dispatch({ type: "SET_SERVERS", payload: servers });
        } catch (err) {
            console.error("Global initialization failed:", err);
        }
    }, [dispatch]);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        
        // Handle masquerade token from URL
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            const token = params.get("masqueradeToken");
            if (token) {
                window.sessionStorage.setItem("masquerade_token", token);
                // Clean URL
                const newUrl = window.location.pathname + window.location.hash;
                window.history.replaceState({}, "", newUrl);
            }
        }

        async function init() {
            dispatch({ type: "SET_LOADING", payload: true });
            await refreshGlobalState();
            dispatch({ type: "SET_LOADING", payload: false });
        }
        void init();
    }, [refreshGlobalState, dispatch]);

    return <>{children}</>;
}
