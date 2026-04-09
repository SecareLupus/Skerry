# Skill: Contract-First Development (Shared Domain)

## Context
Skerry uses a pnpm monorepo structure where `@skerry/shared` (found in `packages/shared`) acts as the single source of truth for types, API request/response structures, and domain constants.

## Rules
1. **Source of Truth Check**: Before adding a new API endpoint, database field, or event type, ALWAYS check `packages/shared/src/domain/contracts.ts`.
2. **Mandatory Updates**: If the required interface or schema does not exist, you MUST add it to `packages/shared` first.
3. **Zod Validation**: Favor using Zod schemas for runtime validation and type inference within the shared package.
4. **Rebuild Step**: After modifying types in `@skerry/shared`, run:
   ```bash
   pnpm --filter @skerry/shared build
   ```
5. **Consumption**: Ensure `apps/control-plane` and `apps/web` import these types/schemas rather than defining local copies.

## Verification
- Run `pnpm typecheck` in the root to ensure both apps align with the updated shared package.
