# Trackify Native

Native Trackify for **macOS** (menu bar), **iOS/iPadOS** (app, widgets, Live Activity) and **Android** (app,
ongoing notification, widgets, Quick Settings tile). Windows is not started.

| | |
|---|---|
| Lane | `trackify/native` — cage `trackify-native`, own Postgres copy of live |
| Branch | `lane/native` (this clone: `/srv/projects/trackify/workbench/worktrees/native`) |
| Lane server | https://trackify-native.dev.bitterlemon.co |
| Downloads | https://trackify-native.dev.bitterlemon.co/downloads/ (APK, macOS zip, iOS instructions) |
| Test accounts (lane only) | `demo@trackify.test` / `trackify-demo`, `native@trackify.test` / `trackify-native` |

## Layout

| Path | What |
|---|---|
| [`docs/NATIVE_SPEC.md`](docs/NATIVE_SPEC.md) | Product + engineering contract (timer engine, visuals, platform surfaces) |
| [`docs/WEB_AUDIT.md`](docs/WEB_AUDIT.md) | Full audit of the web app: screens, API, socket, algorithms — the parity checklist |
| [`docs/SERVER_REQUESTS.md`](docs/SERVER_REQUESTS.md) | API asks from the app builds and what was done |
| [`apple/`](apple/README.md) | Xcode project (XcodeGen), TrackifyKit Swift package, iOS + macOS + widgets |
| [`android/`](android/README.md) | Gradle project, Kotlin + Compose + Glance |
| `screenshots/` | Every screen per platform, light/dark, device matrix |
| `tools/seed_demo.py` | Seeds realistic demo data through the API |

## Server changes on this branch (web stays compatible)

`POST /api/timer/stop` and `/api/timer/switch` (server-side save of the running stretch), 90-day tokens that renew
while used, token login with legacy passwords, `id` on `/api/profile`, `DELETE /api/profile` (account deletion),
`POST /api/profile/password`, hiding a task stops its live timer, chat keeps tool inputs and pending approvals, and an
ETag on `GET /api/tasks`. Plus the live-only Visualizations/leaderboard files mirrored from the prod tree.

The apps work against the **current live server too**: when the new timer routes are missing they fall back to
the web's own flow. Merging this branch into `master` is a separate decision (Workbench todo).

## Build & test

- Lane server: `/srv/projects/trackify/workbench/lanes/native/bin/rebuild`
- Android: see `android/README.md` (`./gradlew testDebugUnitTest assembleRelease`, emulators in `/opt/android-sdk`)
- Apple: build on Taryk's Mac only, after asking him for access (`mac-bridge taryk ask`):
  `/srv/projects/trackify/workbench/lanes/native/bin/macbuild sync|ios|mac|shot|test`. Never on GitHub Actions.

## Known follow-ups (Workbench todos, project `trackify`)

- Web socket accepts `authenticate {userId}` without verification — fix on live (not changed here).
- Apple developer team for device installs/TestFlight, APNs key for Live Activity push, Mac notarization.
- Optional FCM push so the Android notification clears instantly after a web-side stop.
