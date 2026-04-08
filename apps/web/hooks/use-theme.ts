"use client";

import { useEffect, useCallback } from "react";
import { useChat } from "../context/chat-context";
import { updateUserTheme } from "../lib/control-plane";

/**
 * useTheme handles the global application of the dark/light mode preference.
 * It synchronizes the theme state from ChatContext to the document DOM and localStorage.
 */
export function useTheme() {
    const { state, dispatch } = useChat();
    const { theme, viewer } = state;

    // 1. Initial sync from viewer preference (synced from DB) or localStorage
    useEffect(() => {
        if (typeof window === "undefined") return;
        
        const savedTheme = (viewer?.identity?.theme || localStorage.getItem("theme")) as "light" | "dark" | null;
        
        if (savedTheme && savedTheme !== theme) {
            dispatch({ type: "SET_THEME", payload: savedTheme });
        } else if (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches && theme !== "dark") {
            // Default to system preference if no explicit choice exists
            dispatch({ type: "SET_THEME", payload: "dark" });
        }
    }, [viewer?.identity?.theme, dispatch, theme]);

    // 2. Apply theme to HTML root element whenever it changes
    useEffect(() => {
        if (typeof window === "undefined") return;
        
        // Skip applying if we are in the initial 'light' state but the DOM already has a theme
        // set by the blocking ThemeScript. This prevents the "flash" back to light.
        const currentDomTheme = document.documentElement.getAttribute("data-theme");
        if (theme === "light" && currentDomTheme && currentDomTheme !== "light") {
            return;
        }

        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("theme", theme);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        const next = theme === "light" ? "dark" : "light";
        dispatch({ type: "SET_THEME", payload: next });
        void updateUserTheme(next);
    }, [theme, dispatch]);

    return { theme, toggleTheme };
}
