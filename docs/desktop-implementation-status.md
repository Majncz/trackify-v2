# Trackify Desktop — Implementation Status

## Shipped in current implementation

### Repo and packaging
- Added workspace-ready structure for desktop and shared packages.
- Added `apps/desktop` (Tauri + React + TypeScript).
- Added `packages/shared-types` for shared domain contracts.
- Added `packages/api-client` for typed backend requests.

### Desktop app foundation
- Tray/menu implementation in Tauri native layer.
- Quick tracker panel UI in React.
- Start/stop timer UX with project/task + note controls.
- Running timer clock and today total display.
- Styling aligned with Trackify card/input/button language.

### Reliability primitives
- Offline queue module with retries/backoff utility.
- Timer state machine module for deterministic transitions.
- Unit tests for queue logic and timer transitions.

### Build/release foundation
- Added desktop scripts at repo root:
  - `npm run desktop:dev`
  - `npm run desktop:build`
  - `npm run desktop:test`
- Added desktop CI workflow for macOS + Windows build jobs.
- Local Tauri app bundle build verified on macOS.

---

## Verified commands and outcomes
- `npm run desktop:test` ✅ (5 tests passed)
- `npm run desktop:build` ✅
- `npm run tauri:build --workspace @trackify/desktop` ✅
  - Output: `apps/desktop/src-tauri/target/release/bundle/macos/Trackify.app`

---

## Next chunks (already planned)

1. **Real API integration**
   - Replace local mock entities with Trackify V2 API entities.
   - Hook start/stop/switch actions to backend endpoints.

2. **Secure token storage**
   - Integrate platform credential storage and refresh semantics.

3. **Durable offline sync**
   - Persist queue to disk and reconcile on startup.
   - Add idempotency keys and conflict-resolution rules.

4. **Native productivity features**
   - Global shortcut wiring.
   - Notifications/reminders with user settings.
   - Launch-at-login toggle.

5. **Release hardening**
   - Cross-platform artifact validation in CI.
   - Code-signing + updater activation when keys are provided.

---

## Notes
- Updater config is scaffolded but disabled until signing/update endpoints are configured.
- Current bundle target is `app` for stable local verification.
