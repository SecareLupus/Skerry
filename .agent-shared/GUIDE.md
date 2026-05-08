# Skerry Agent Guide

This is the single source of truth for environment context, testing discipline, and workflow hygiene. 

## Environment Context

### Machine Roles
- **localhost / development machine**: Where source edits happen. Used for unit tests and local integration.
- **testing machine**: Runs `git pull && docker compose down && docker compose up -d --build`.
- **production machine**: Final target. (Currently, `pangolin` acts as a production-like test server).

### Public-Facing Test Server (`pangolin`)
- **URL**: https://hatch.pangolin.showgroundslive.com
- **SSH**: `ssh root@10.0.20.121` (Use LAN IP from within the network).
- **Behavior**: Default assumption for user reports unless specified otherwise.

### Issue Triage Protocol
1. Infer machine from context; don't assume localhost.
2. Gather logs from the reporter's host (e.g. `pangolin`) before local reproduction.
3. Reproduce locally when feasible.
4. Verify using the bar defined in `TESTING` below.

## Testing Discipline

### TDD Rules
- **Bug Fixes Require Tests**: Locating existing tests and matching style is mandatory.
- **Level**: Unit > Integration > E2E. Use the lowest level that catches the regression.
- **Fail First**: Confirm the test fails before applying the fix.
- **Real-Time E2E**: Any feature touching the real-time loop (messages, typing, presence, bridge status) MUST have a Playwright E2E test. No mocking Matrix/SSE in E2E.

### Skerry Test Commands
| Scope | Command |
| --- | --- |
| All tests | `pnpm test` |
| Shared package | `pnpm --filter @skerry/shared test` |
| Control-plane | `pnpm --filter @skerry/control-plane test` |
| Web unit | `pnpm --filter @skerry/web test` |
| E2E | `pnpm test:e2e` |
| Full pre-submit | `pnpm test:all` |

**Frameworks**: Unit uses Node test runner (`tsx --test` + `node:assert`). E2E uses Playwright.

## Workflow Hygiene (Token Optimization)

- **TODO.md**: Strictly for active tasks and open questions. No history.
- **Purge on Commit**: When a task lands, move its notes to `ARCHIVE.md` or delete them.
- **Lean Context**: Session start only mandates reading `TODO.md`. Consult this `GUIDE.md` only as needed.
- **Commit Messages**: Use descriptive commits for permanence. Avoid redundant "Implementation Reports" in the repo.
