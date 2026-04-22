# Trackify Desktop — Implementation Status

## Shipped in current implementation

### Repo and packaging
- Added workspace-ready structure for desktop and shared packages.
- Added `apps/desktop` (Tauri + React + TypeScript).
- Added `packages/shared-types` for shared domain contracts.
- Added `packages/api-client` for typed backend requests.

### Desktop app foundation
- Tray/menu implementation in Tauri native layer.
- Tray status item plus tray start/stop/open actions wired to the React app.
- Quick tracker panel UI in React.
- Start/stop timer UX with project/task + note controls.
- Running timer clock and today total display.
- Styling aligned with Trackify card/input/button language.
- API base URL settings persisted locally.
- Launch-at-login toggle wired through native autostart plugin.
- Token save + clear controls wired to OS keychain.

### Reliability primitives
- Offline queue module with retries/backoff utility.
- Timer state machine module for deterministic transitions.
- Integration-style desktop tests for tray actions, settings persistence, token clearing, stale task-response guards, and auth-expiry handling across bootstrap/read/mutation/sync paths.
- Unit tests for queue logic and timer transitions.

### Build/release foundation
- Added desktop scripts at repo root:
  - `npm run desktop:dev`
  - `npm run desktop:build`
  - `npm run desktop:test`
  - `npm run desktop:bundle`
  - `npm run desktop:artifacts`
- Added desktop CI workflow for macOS + Windows build jobs.
- CI now builds verifiable desktop packaging artifacts:
  - macOS: `app`
  - Windows: `nsis`
- CI now uploads per-platform bundle artifacts plus a manifest/checksum record for provenance.
- Local Tauri app bundle build verified on macOS.

---

## Verified commands and outcomes
- `npm run desktop:test` ✅ (22 tests passed)
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` ✅ (3 lifecycle tests passed)
- `npm run desktop:build` ✅
- `npm run desktop:bundle` ✅
  - Output: `apps/desktop/src-tauri/target/release/bundle/macos/Trackify.app`
- `npm run desktop:artifacts` ✅
  - Output: `artifacts/desktop/macos/{manifest.json,checksums.txt}`

---

## Next chunks (already planned)

1. **Packaging / release hardening**
   - Validate Windows packaging locally or in CI with artifact inspection.
   - Verify tray/background behavior across startup/login and app relaunch paths.
   - Prepare code-signing + updater activation when keys are provided.

2. **Real API integration hardening**
   - Replace remaining local mock fallbacks with Trackify V2 API entities.
   - Reduce reliance on optimistic local-only timer assumptions.

3. **Durable offline sync**
   - Persist queue to disk and reconcile on startup.
   - Add idempotency keys and conflict-resolution rules.

4. **Native productivity features**
   - Global shortcut wiring.
   - Notifications/reminders with user settings.
   - Tray-driven quick actions beyond start/stop.

---

## Notes
- Updater config is scaffolded but disabled until signing/update endpoints are configured.
- Current bundle target is `app` for stable local verification.
