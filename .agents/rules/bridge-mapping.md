# Skill: Bridge State Mapping Consistency

## Context
Skerry bridges Discord and other platforms. Every message, edit, and reaction must be mapped between the local Matrix ID and the external provider ID (Discord message ID, etc.) to ensure bi-directional consistency.

## Rules
1. **Implicit Mapping Check**: When implementing "Edit" or "Delete" handlers in the bridge logic, always look up the mapping in the `external_message_mappings` (or equivalent) database table first.
2. **Graceful Fallback**: If a mapping is missing (desync), log a structured warning and provide a fallback if possible (e.g., matching by content/timestamp as a last resort).
3. **Idempotency**: Use `idempotencyKey` when creating bridged messages to prevent duplicate posts during network failures.
4. **Validation**: Use Zod schemas from `contracts.ts` to validate external payloads before they reach the core chat service.

## Verification
- Use `pnpm test` in `apps/control-plane` to run bridge-specific unit tests that simulate desync scenarios.
