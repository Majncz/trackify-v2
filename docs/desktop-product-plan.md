# Trackify Desktop (macOS + Windows) — Product Plan

## Goal
Ship a full desktop companion app for Trackify V2 that runs from tray/menu bar, keeps time tracking frictionless, and stays visually consistent with the existing Trackify web app.

---

## Product Scope (Full)

### Core time tracking
- Start/stop timer
- Project + task selection
- Optional note on entry
- Running timer indicator + elapsed clock
- Today summary (total tracked)
- Resume previous timer shortcut

### Background-first desktop behavior
- Tray/menu bar icon always available
- Quick panel opens near tray icon
- App keeps running when main window closes
- Optional auto-start at login
- Global shortcut to open quick panel / toggle timer

### Reliability and sync
- API-first client for all tracking operations
- Offline action queue (start/stop/update)
- Deterministic conflict policy on reconnect
- Exponential backoff + jitter retries
- Local cache for current timer + recent entities
- Safe restart recovery (replay unsynced actions)

### Security
- Access/refresh token storage in OS secure store
  - macOS Keychain
  - Windows Credential Manager
- Sensitive fields redacted in logs
- Session refresh and forced re-auth handling

### Notifications and productivity
- Native notifications for long-running timer reminders
- Optional inactivity nudge
- Optional daily stop-time reminder

### Maintainability / ops
- Shared typed API client package
- Shared domain types package
- Structured telemetry and error reporting
- CI desktop build pipeline
- Signed installer pipeline (when certs available)
- Auto-update wiring (feature-flagged)

---

## Repository Strategy (same repo)

### Target monorepo shape
- `apps/web` (existing Next.js Trackify app)
- `apps/desktop` (Tauri + React quick panel)
- `packages/api-client` (typed fetch client + auth handlers)
- `packages/shared-types` (DTOs and domain models)
- `packages/ui` (optional shared tokens/components)

### Transitional strategy
Because current repo is single-app Next.js:
1. Introduce workspace configuration while preserving existing web app behavior.
2. Add desktop app in parallel.
3. Move shared logic incrementally (no big-bang migration).

---

## Technical Architecture

### Desktop shell
- Tauri for native host
- React + TypeScript for panel UI
- Single quick panel window + optional settings window
- Tray events control open/focus/hide behavior

### Desktop domain modules
- `auth/` secure token persistence + refresh
- `timer/` local running state + transitions
- `queue/` offline action log + retry scheduler
- `sync/` API reconciliation + conflict resolver
- `projects/` cached project/task lookup
- `notifications/` reminder orchestration
- `settings/` shortcuts, startup, reminders

### API interaction model
- All writes are command events:
  - `START_TIMER`
  - `STOP_TIMER`
  - `UPDATE_NOTE`
  - `SWITCH_TASK`
- Each command gets:
  - local optimistic apply
  - persisted queue record
  - sync attempt
  - ack reconciliation

### Conflict semantics (proposed)
- Server is source of truth for final persisted entries
- Client keeps causal ordering with local sequence id
- On reconnect:
  1. pull latest running entry
  2. replay pending commands in order
  3. resolve duplicate starts by server timestamp precedence
  4. if unresolved, move action to `manual-review` bucket and notify user

---

## UX/Design Alignment

### Visual parity rules
- Reuse Trackify color tokens and typography scale
- Same card/button/input style as web
- Same icon language and spacing rhythm
- Same dark/light behavior

### Desktop-specific constraints
- Compact panel density prioritized
- Primary actions reachable in one click
- All critical states visible without scrolling where possible

---

## Delivery Phases

### Phase 1 — Foundation
- Workspace setup
- Desktop shell scaffold
- Shared types + API client extracted
- Auth/token secure storage

### Phase 2 — Tracking Engine
- Running timer model
- Start/stop/switch flows
- Today total and optimistic UI
- Tray presence and panel open/close

### Phase 3 — Reliability
- Offline queue + replay
- Retry/backoff
- Recovery after restart
- Error and telemetry pipeline

### Phase 4 — Native polish
- Startup at login
- Global shortcut
- Notifications/reminders
- Settings panel

### Phase 5 — Release readiness
- Desktop CI matrix (mac/windows)
- Packaging and signing hooks
- Auto-update integration (flagged)
- QA and regression pass

---

## Testing Strategy

### Unit tests
- Timer state transitions
- Queue ordering and dedupe
- Retry scheduler behavior
- Conflict resolution rules

### Integration tests
- API sync happy path
- Offline → reconnect replay
- Token refresh failure + re-auth

### E2E smoke
- App boot
- Tray icon present
- Start timer from tray
- Stop timer and verify persisted entry

---

## Risks & mitigations
- **Auth edge cases** → centralize refresh + force-login fallback
- **Duplicate entries on reconnect** → idempotency keys + replay guards
- **Tray behavior differences by OS** → explicit per-OS handling and QA matrix
- **Installer trust prompts** → signing pipeline + release checklist

---

## Done criteria (definition of done)
- Desktop app starts on mac and windows build pipelines
- Tray workflow works without opening full window
- Time tracking remains functional offline and syncs correctly
- Secure token storage verified on both platforms
- Tests pass for core state/sync logic
- Release artifacts produced by CI

---

## Current status
- Plan finalized and checked into repo.
- Next execution step: scaffold desktop app + workspace layout and commit as first implementation chunk.
