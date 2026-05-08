# AGENTS.md

## Read-First (every session)

To minimize token costs, only read the active task list at the start of every session:

1. `.agent-shared/TODO.md` — active tasks and open questions.

**Consult only as needed:**
- `.agent-shared/GUIDE.md` — environment, testing, and hygiene rules.
- `.agent-shared/ARCHIVE.md` — historical notes and logs.

When ending a session, update `TODO.md` and move any completed task notes to `ARCHIVE.md`.

## Repository Skills

- [`.agents/rules/bridge-mapping.md`](.agents/rules/bridge-mapping.md) — Discord/Matrix bridge consistency
- [`.agents/rules/component-decomposition.md`](.agents/rules/component-decomposition.md) — keeping web components under 500 lines
- [`.agents/rules/contract-first.md`](.agents/rules/contract-first.md) — `@skerry/shared` as single source of truth
- [`.agents/rules/hierarchical-theming.md`](.agents/rules/hierarchical-theming.md) — theme tokens, no hardcoded colors
- [`.agents/rules/real-time-validation.md`](.agents/rules/real-time-validation.md) — mandatory E2E for real-time features

## Project Scope

These instructions apply to the entire Skerry repository.

## Mission

Build a Matrix-based Creator Co-Op Hub platform with Discord-like semantics (servers, channels, scoped moderation, voice/video conferencing, Discord bridging), following the reference architecture.

## Engineering Guardrails

- **Single-Domain Routing**: Maintain the path-based routing strategy implemented via Caddy (`/auth`, `/v1`, `/_matrix`, etc.). Do not introduce new subdomains.
- **Control Plane Authority**: The control plane remains the primary policy gate for all privileged operations.
- **Resource Lifecycle**: Ensure Matrix rooms and LiveKit tokens are managed via the control plane workflows.
- **Service Hostnames**: Use internal Docker service names (e.g., `control-plane:4000`, `synapse:8008`) for all service-to-service communication.
- **Incrementalism**: Prefer composable, incremental updates over sweeping architectural rewrites.
- **Type Safety**: Maintain strict TypeScript settings; avoid `any` wherever possible.

## Repository Conventions

- **Monorepo**: Uses pnpm workspaces.
  - `apps/web`: Next.js web client.
  - `apps/control-plane`: Fastify provisioning/policy API.
  - `packages/shared`: Shared types, constants, and domain contracts.
- **Shared Packages**: Keep domain logic and contracts in `packages/shared` to be consumed by both apps.
- **Deployment**: The primary deployment target is Docker Compose, managing the full stack of services.

## Validation Checklist

Before submitting changes, ensure the following pass:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test` (includes unit and e2e tests)
