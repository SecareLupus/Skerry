# Skill: Component Decomposition (De-bloat)

## Context
The primary web application (`apps/web`) has several legacy "God components" that exceed 1,000 lines. To maintain high velocity and reduce merge complexity, we must strictly adhere to modularity.

## Rules
1. **Size Limit**: Aim to keep components under 500 lines. If a file is approaching 800-1,000 lines, it is a priority for refactoring.
2. **Logic Extraction**:
   - Complex state management or effect logic should be moved to a custom hook in `apps/web/hooks`.
   - Modals and large UI overlays should be extracted into the `apps/web/components/modals` or `apps/web/components/layout` directories.
3. **Pure Rendering**: Prefer functional components that receive props, minimizing the use of deep `useContext` dependency chains where possible.
4. **Naming**: New sub-components should follow the kebab-case naming convention (e.g., `message-bubble.tsx`, `role-badge.tsx`).

## Refactoring Trigger
When modifying a file listed in the "Triage Backlog" or "Phase 16 Household" (e.g., `chat-window.tsx`, `sidebar.tsx`), proactively identify one logical section to extract if the file is already over-sized.
