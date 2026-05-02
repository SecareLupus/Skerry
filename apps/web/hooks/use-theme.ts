"use client";

import { useEffect, useCallback, useRef } from "react";
import { useChat } from "../context/chat-context";
import { updateUserTheme } from "../lib/control-plane";

/**
 * useTheme handles the global application of the dark/light mode preference.
 * It synchronizes the theme state from ChatContext to the document DOM and localStorage.
 */
export function useTheme() {
    const { state, dispatch } = useChat();
    const { theme, viewer } = state;
    const hasAppliedRef = useRef(false);

    // 1. Sync from external sources (viewer preference, localStorage, or system pref).
    // Deps intentionally exclude `theme` — this effect mirrors EXTERNAL state into the
    // reducer, not the other way around. Including `theme` would cause it to re-fire
    // after toggleTheme and overwrite the user's just-clicked choice with the stale
    // localStorage value (which Effect 2 hasn't written yet).
    useEffect(() => {
        if (typeof window === "undefined") return;

        const savedTheme = (viewer?.identity?.theme || localStorage.getItem("theme")) as "light" | "dark" | null;

        if (savedTheme) {
            dispatch({ type: "SET_THEME", payload: savedTheme });
        } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
            dispatch({ type: "SET_THEME", payload: "dark" });
        }
    }, [viewer?.identity?.theme, dispatch]);

    // 2. Apply theme to HTML root element whenever it changes
    useEffect(() => {
        if (typeof window === "undefined") return;

        // FOUC guard: on the very first render, React's default `theme` is "light"
        // but ThemeScript may have already applied a non-light theme to the DOM.
        // Don't overwrite it — wait for Effect 1 to dispatch the correct state.
        // Subsequent renders (including user toggles) skip this guard.
        if (!hasAppliedRef.current) {
            const currentDomTheme = document.documentElement.getAttribute("data-theme");
            if (theme === "light" && currentDomTheme && currentDomTheme !== "light") {
                return;
            }
        }
        hasAppliedRef.current = true;

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
