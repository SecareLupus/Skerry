# Skill: Hierarchical Theme Injection

## Context
Skerry allows Hubs and Spaces to override styles via CSS variables. This is handled by the `ThemeEngine.tsx` component which injects variables in a specific priority:
`Globals (CSS) < Hub Theme < Space Theme`.

## Rules
1. **No Hardcoded Values**: Never use fixed hex/rgb values in components (e.g., `color: #00FF00`).
2. **Mandatory Token Usage**: Always use `@skerry/shared` tokens or CSS variables prefixed with `--sk-`.
   - Primary Color: `var(--sk-primary-color)`
   - Background Accent: `var(--sk-bg-accent)`
3. **Variable Mapping**: If a new UI feature needs a themeable color, add the declaration to `ThemeEngine.tsx` and ensure it maps to a property in the `Hub` or `Server` theme Record.
4. **Tailwind Limitation**: When using Tailwind classes, use the theme-aware variants if configured (e.g., `text-sk-primary` if available) otherwise use `text-[var(--sk-primary-color)]`.

## Verification
- Test UI changes by switching between "Dark Mode" and a "Custom Hue" in the Hub settings to verify inheritance works correctly.
