# Skerry Agent Archive: Historical Notes & Logs

This file contains historical context, handoff notes, and chat logs moved out of the active context to reduce token bloat.

## Historical Chat Logs (from chat-log.md)

(Historical logs from 2026-05-02 to 2026-05-07)

## Historical Plan Notes (from current-plan.md)

### 2026-05-09 — Sprint 2 closeout
Sprint 2 fully closed. PR #100 (`fix/sprint-2-tail`) merged 2026-05-09,
landing #34 (onboarding "Display Name" rename + widened validation
regex + 2 new control-plane tests) and #38 (verified already fixed by
the permissions sprint; 6-tier round-trip integration test added).
Follow-up commit `2ede4c0` aligned `accessibility.spec.ts` and
`visual-regression.spec.ts` with the renamed onboarding heading
("Choose Username" → "Choose Display Name") after a CI miss. Issues
#34 and #38 closed and moved to Done on Project #2. Sprint 2 final
status: ✅ #9, ✅ #23, ✅ permissions sprint (PRs #94/#95/#96/#97/#98
under #99), ✅ #34, ✅ #38.

### 2026-05-07 19:44 — P1 (Role enum cleanup)
Permissions sprint P1 (Role enum cleanup) landed on feat/permissions-sprint-p1-role-cleanup. Migration 034 backfills hub_members for non-bridged identities with role='user' bindings and drops every role='user' / role='visitor' binding. Bridged Discord identities are protected via the matrix_user_id NOT LIKE '@discord_%' guard. Role enum reduced to 5 values; INVITE_BAKEABLE_ROLES reduced to two; useHubInvite no longer writes a role binding when defaultRole is null (plain hub membership covers it). All suites green: shared 16/16, web 12/12, control-plane 129/129 (run on the live test stack).

### 2026-05-07 14:50 — Issue #23 Slice C
Issue #23 Slice C (invite management + default badges + redemption audits + role_bindings dedup) landed on the same branch (PR #92). User scoped Slice C explicitly after rejecting "merge as-is + separate ticket": invite-only cleanup, with the broader permissions sprint carved out. Backend shipped in commit b767da7; UI in the next commit.

### 2026-05-07 13:30 — Issue #23 Slice B
Issue #23 Slice B (default role + default server on invites) landed on the same branch as Slice A (fix/issue-23-unauth-invite-redeem, PR #92). Schema migration + shared type extension + service + route + UI + 2 new control-plane test cases.

### 2026-05-07 12:16 — Issue #23 Slice A
Issue #23 Slice A (unauthenticated invite redeem + modal title) landed on fix/issue-23-unauth-invite-redeem.

### 2026-05-04 14:35 — Sprint 2 Kickoff
Sprint 2 kicked off. Issue #9 (Multiple OIDC Accounts "Guest" Issue) merged via PR #91 (commit 0ea2018).

---
*For older entries, see Git history.*
