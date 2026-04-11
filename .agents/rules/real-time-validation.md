# Skill: Real-time Loop Validation (Red-Green-E2E)

## Context
Skerry relies on a complex event loop: User Action -> Control Plane API -> Matrix Synapse -> SSE Bus -> Frontend UI. Traditional unit tests often miss race conditions in this loop.

## Rules
1. **Mandatory E2E**: Any new feature involving real-time synchronization (messages, typing indicators, presence, bridge status) MUST include or update an E2E test in `apps/web/e2e`.
2. **Multi-Session Assertion**: Tests should ideally simulate multiple sessions to verify that an action from User A is reflected correctly in User B's UI without a page refresh.
3. **Flakiness Awareness**: Use the project's established retry patterns and avoid hardcoded timeouts. Use Playwright's `expect(locator).toBeVisible()` which automatically retries.
4. **Mocking Limitation**: Avoid mocking Matrix or SSE during E2E tests unless absolutely necessary for external vendor isolation (e.g., Discord API). We want to test the full stack.

## Testing Stack
- **E2E**: Playwright (`apps/web/e2e/**/*.spec.ts`)
- **Integration**: Vitest (`apps/control-plane/test/**/*.test.ts`)
