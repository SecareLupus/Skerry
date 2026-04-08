"use client";

import React from "react";

/**
 * ThemeScript is a blocking inline script that prevents the "Flash of Unstyled Content" (FOUC)
 * by applying the correct theme (dark/light) to the document element BEFORE the initial paint.
 */
export function ThemeScript() {
  const code = `
(function() {
  try {
    var theme = localStorage.getItem('theme');
    var supportDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches === true;
    if (!theme && supportDarkMode) theme = 'dark';
    if (!theme) theme = 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
  `.trim();

  return (
    <script
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
