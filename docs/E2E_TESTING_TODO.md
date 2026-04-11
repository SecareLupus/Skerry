# Skerry E2E Testing Roadmap

This document outlines the Master TODO list for the Playwright E2E test suite. The tests are organized into **Execution Sequences** to minimize system resets and maximize state reuse.

---

## 🚀 Execution Sequence A: Community Lifecycle
**Objective:** Test the "Golden Path" for creators and members in a fresh instance.
**Initial State:** `docker compose -f docker-compose-test.yml up -d` (Fresh DB)

### A1. Onboarding & Core UI
- [x] **A1.1: Hub Bootstrap Verification**
  - Verify that the hub is initialized with the correct default server/space name.
  - Verify that the sidebar manifests all default channels correctly.
- [x] **A1.2: Developer Login Flow**
  - Use the bypass auth to log in to the test environment.
  - Assert that the landing page transitions to the hub view.
- [x] **A1.3: User Profile Verification**
  - Open the profile editor.
  - Verify user nickname and bio persistence.

### A2. Server & Channel Orchestration
- [ ] **A2.1: Creator Server Creation**
  - Admin: Create a new Server (Matrix Space).
  - Verify the new server icon appears in the server rail.
- [ ] **A2.2: Channel Architecture**
  - Create a Category (sub-space).
  - Create a Text Channel inside a Category.
  - Create a Voice Channel inside a Category.
  - Verify the UI hierarchy correctly reflects the nesting.
- [ ] **A2.3: Invite System**
  - Admin: Generate an Invite Link for the new Server.
  - Member B: Access the invite (via a separate context/incognito user).
  - Verify successful joining and display of the server list.

### A3. Advanced Messaging & Social
- [ ] **A3.1: Real-time Multi-user Chat**
  - Verify that messages sent by User A appear instantly for User B via SSE/EventBus.
- [ ] **A3.2: Markdown & Rich Text**
  - Test bold, italic, code blocks, and clickable links.
- [ ] **A3.3: Message Lifecycle**
  - **Edit:** Change message content; verify "Edited" timestamp/indicator.
  - **Delete:** Remove a message; verify it disappears for all users.
- [ ] **A3.4: Social Interactions**
  - **Reactions:** Add and remove multiple emoji reactions; verify count sync.
  - **Threads:** Start a thread on a message; reply in the thread; verify reply count update in the main feed.
  - **Mentions:** @mention User B; verify highlight or local notification trigger.

### A4. Permissions & Moderation
- [ ] **A4.1: Permission Gates**
  - Verify that Member B *cannot* access the Server Settings or create channels.
- [ ] **A4.2: Scoped Moderation Actions**
  - Moderator: **Timeout** User B (verify User B's composer is disabled).
  - Moderator: **Redact** User B's message.
  - Moderator: **Kick/Ban** User B from the Server (verify User B is removed from the Space but still exists in the Hub).
- [ ] **A4.3: Audit Log & Reporting**
  - Member B: Report a message for abuse.
  - Admin: Verify the report appears in the Moderation Queue.
  - Verify that all moderation actions appear in the Server Audit Log.

---

## 🛠️ Execution Sequence B: Discord Orchestration
**Objective:** Test the Application Service bridge and bidirectional consistency.
**Initial State:** Sequence A completed OR configured bridge mocks active.

### B1. Bridge Lifecycle
- [ ] **B1.1: Guild Connection**
  - Admin: Connect a Discord Guild (simulated OAuth).
  - Map a Local Channel to a Discord Channel ID.
- [ ] **B1.2: Outbound Sync (Skerry -> Discord)**
  - Send message in Skerry -> Verify arrival in Discord (Mock/API Check).
- [ ] **B1.3: Inbound Sync (Discord -> Skerry)**
  - Send message in Discord -> Verify arrival in Skerry with correct author attribution.
- [ ] **B1.4: Formatting Consistency**
  - Test Discord specific formatting (stickers, custom emoji IDs) rendering in Skerry.

---

## 🔊 Execution Sequence C: Real-time Engine (RTC)
**Objective:** Test LiveKit signaling and UI coordination.
**Initial State:** Stable network + LiveKit container healthy.

### C1. Voice signaling
- [ ] **C1.1: Room Join & Token Exchange**
  - User clicks Voice Channel -> Request token from Control Plane.
  - Verify successful connection to LiveKit test server.
- [ ] **C1.2: Participant Roster**
  - Join multiple users -> Verify roster list updates in the right rail/voice panel.
- [ ] **C1.3: Track Negotiation**
  - Mute/Unmute microphone -> Verify tracks are disabled/enabled on the SFU.
  - Enable Camera -> Verify video stream renders in the "Stage" layout.

---

## 📝 Implementation Notes
- **Test User A:** Admin (Creator).
- **Test User B:** Member (Guest).
- **Resets:** System reset is only mandatory between Sequence groups (e.g., after Sequence A completes, wipe for Sequence B).
