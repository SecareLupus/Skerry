# Skerry Active Tasks

## Current Goal: Sprint 2
Land remaining Sprint 2 issues. **No batching, one PR per issue.**

## Tasks
- [x] **Issue #9**: OIDC Display Name (`fix/issue-9-oidc-display-name`).
- [x] **Issue #23**: Invite Link Generation (`fix/issue-23-unauth-invite-redeem`).
- [/] **Permissions Sprint**:
    - [x] **P1**: Role enum cleanup.
    - [x] **P3**: Default Space Owner = Hub
      (`feat/permissions-sprint-p3-default-space-owner`).
    - [x] **P2**: Audience tiers, cascade, and capability split.
        - [x] **P2.a**: Capability split.
        - [x] **P2.b**: Normalized access-rules tables + tier
          expansion + cascade.
        - [x] **P2.cleanup**: Drop legacy `*_access` columns +
          DB triggers. Branch
          `feat/permissions-sprint-p2cleanup-drop-legacy-access`.
- [ ] **Issue #34**: Onboarding Display Name (Blocked on permissions).
- [ ] **Issue #38**: Server Permissions Persistence (Likely subsumed by P2).

## Open Questions
- None.

---
*For historical notes and completed sprint logs, see [ARCHIVE.md](./ARCHIVE.md).*
