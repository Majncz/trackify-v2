# Trackify for Apple platforms

Native **macOS menu-bar app** and **iOS / iPadOS app** for Trackify, with home-screen & lock-screen widgets,
a Live Activity + Dynamic Island, a Control Center control, Siri/Shortcuts intents and macOS desktop widgets.
Everything the web app does is here (Home, timer, fix session, log past time, leaderboard, time-spent heat grid
and yearly calendar, task detail + billing, Stats + groups, Team race, Billing incl. AI billing, AI chat with tool
approvals, Settings) plus native extras (edit/delete time entries, change password, delete account, reminders).

Contract: [`../docs/NATIVE_SPEC.md`](../docs/NATIVE_SPEC.md) · Web reference: [`../docs/WEB_AUDIT.md`](../docs/WEB_AUDIT.md)

---

## Open in Xcode

Requirements: Xcode 16+ (CI uses Xcode 26.6), iOS 17+ / macOS 14+.

```sh
open native/apple/Trackify.xcodeproj        # generated project is committed
```

The project is generated from [`project.yml`](project.yml) with [XcodeGen](https://github.com/yonaskolb/XcodeGen).
After adding/removing files, regenerate it: `brew install xcodegen && cd native/apple && xcodegen generate`.

Schemes:

| Scheme | What it builds |
|---|---|
| **Trackify** | iOS/iPadOS app + widget extension (widgets, Live Activity, Control Center control) |
| **TrackifyMac** | macOS menu-bar app + desktop widget extension |

## Set your team (one place)

Edit **[`Config/Signing.xcconfig`](Config/Signing.xcconfig)**:

```
DEVELOPMENT_TEAM = ABCDE12345
```

That's all — every target inherits it. With automatic signing Xcode registers the bundle ids and the
App Group `group.co.bitterlemon.trackify` for you. Bundle ids: `co.bitterlemon.trackify` (iOS),
`co.bitterlemon.trackify.mac` (macOS), extensions `….widgets` / `….mac.widgets`. To use a different
prefix, change `TRACKIFY_BUNDLE_ID` / `TRACKIFY_APP_GROUP` in the same file (and `AppGroup.id` in
`Packages/TrackifyKit/Sources/TrackifyKit/SharedStorage.swift`).

## Run on a device

1. Set the team (above), plug in the device, pick the **Trackify** scheme and your device, Run.
2. Widgets: long-press the home screen → **+** → Trackify. Lock-screen widgets and the Control Center
   control (iOS 18) are in the respective galleries. The Live Activity appears automatically while a timer runs.
3. Siri/Shortcuts: "Start *task* in Trackify", "Stop Trackify", "What am I tracking in Trackify".
4. macOS: run **TrackifyMac**. The app lives in the menu bar (no Dock icon unless the Dashboard window
   is open). ⌃⌥T toggles the panel from anywhere. Desktop widgets: right-click the desktop → Edit Widgets.

## Pointing at a server

The default server is the live one, `https://trackify.ranajakub.com`. On the sign-in screen open
**Advanced** and enter another origin (e.g. `https://trackify-native.dev.bitterlemon.co`). It's remembered
per install. Test accounts on the lane server: `demo@trackify.test` / `trackify-demo` (rich data),
`native@trackify.test` / `trackify-native` (near-empty).

The app talks to the lane-only native endpoints (`/api/timer/switch`, `/api/timer/stop`, ETag on `/api/tasks`)
and automatically falls back to the web's flow on servers that don't have them (NATIVE_SPEC §2).

## Architecture

```
Packages/TrackifyKit   Foundation-only Swift package (builds & tests on Linux)
  Models, JSON (ISO dates), APIClient + Endpoints
  TimerEngine          optimistic, persisted op queue (switch/stop/adjustStart), backoff, 404 legacy fallback
  SocketIO             Engine.IO v4 / Socket.IO v4 client on URLSessionWebSocketTask (token auth, reconnect)
  Chat                 AI SDK v6 UI-message SSE parser + stream reducer, tool copy
  Analytics/SessionMath/TeamMath/BillingMath/Accent/Formatters — every web algorithm, with the audit's test vectors
  SharedStorage        Keychain (App Group access group) → App Group defaults fallback, widget snapshot
Shared/                SwiftUI used by both apps: design system, AppModel, all feature screens
iOS/                   App entry, Timer·Stats·Team·More tabs (iPhone) / sidebar (iPad), Live Activity controller
macOS/                 NSStatusItem + panel, global hotkey (Carbon), dashboard window + activation policy
Widgets/               WidgetKit: timer widgets (+accessory), Live Activity, Control (iOS 18)
Intents/               App Intents shared by apps and widgets (Start Task, Stop Timer, Current Timer, widget buttons)
UITests/, RenderTests/ screenshot walk + timer flow tests; widget/Live Activity rendering
```

* **Timer engine** — user actions apply instantly, are appended to a persisted FIFO queue in the App Group and
  replayed one at a time (`2xx` drop, `401` sign out, `408/429/5xx/offline` retry with 0.6 s×1.6 backoff up to 8 s,
  other `4xx` drop + "Couldn't save: …" banner). While ops are pending, socket timer events are ignored; otherwise
  `GET /api/timer` and socket `timer:*` events are the truth. Elapsed time is always computed locally.
* **Widgets & intents** act through the same engine: in the app process they use the app's engine; in the widget
  extension they build a short-lived engine over the shared store, apply the op, update the snapshot, try to sync
  and ping the app (Darwin notification).
* **Performance** — last server data is cached on disk (App Group) and shown instantly on launch; `/api/tasks`
  uses the lane's weak ETag (`If-None-Match` → 304). Stats, heat grid and calendar are computed off the main actor;
  long lists are lazy; the 1000-day heat grid is virtualised; refreshes are debounced (400 ms, presence 1 s);
  widgets reload only when the snapshot changes; the iOS socket disconnects in the background; the macOS menu-bar
  label ticks once per minute (per second only with "show seconds"); the panel/dashboard drop their view trees
  while hidden.

## Measured (CI, GitHub `macos-26` runners)

| What | Result |
|---|---|
| macOS idle CPU, menu-bar only, timer running, 30 s sample | **0.03–0.13 %**, RSS ≈ 75 MB |
| iOS launch (`XCTApplicationLaunchMetric`, Debug build, iPhone 17 Pro simulator on a shared CI VM, 3 runs) | ≈ 2.3–3.2 s avg (cold, includes simulator overhead); cached tasks/profile render before the first network response |
| TrackifyKit unit tests (Linux + macOS) | 49 tests, incl. audit test vectors, timer-queue/offline/legacy-fallback, SSE, Socket.IO frames; live read-only decoding + socket auth on macOS |
| UI tests | screenshot walk (all screens), Live Activity on lock screen/Dynamic Island, end-to-end timer flow against the lane API (start → switch → fix → stop → log past → live sync via socket) |
| Device matrix | iPhone 16e, 17, 17 Pro (light/dark, landscape, Accessibility-L), 17 Pro Max, iPad Pro 13" (portrait/landscape, sidebar), iPad mini, iPhone SE (3rd gen) on iOS 18.6; macOS panel/dashboard light+dark at 900×600 and 1200×820 |

## Tests & CI

* Linux fast loop: `Scripts/linux-test.sh` runs TrackifyKit's unit tests in Docker (`swift:6.1-noble`);
  `TRACKIFY_LIVE=1 Scripts/linux-test.sh --filter LiveServerTests` adds read-only decoding checks against the lane.
  `Scripts/xcodegen-linux.sh` regenerates the Xcode project on Linux.
* GitHub Actions: [`.github/workflows/native-apple.yml`](../../.github/workflows/native-apple.yml) on `macos-26`
  runs the package tests (incl. live socket auth), generates the project, builds iOS (simulator, unsigned) and macOS
  (ad-hoc), then `Scripts/ci-screenshots.sh`: UI-test screenshot walk (push: iPhone 17 Pro + iPad; manual dispatch
  `shots=full`: iPhone 16e/17/17 Pro/17 Pro Max, dark, landscape, Accessibility-L text, iPads, plus a `macos-15`
  job on iPhone SE (3rd gen) · iOS 18), the end-to-end timer flow test against the lane API, widget renders, and
  macOS screenshots + idle-CPU measurement. Artifacts: screenshots, `.xcresult`s, logs, `Trackify-macOS.zip`,
  generated project.
* Versioning: CI builds are stamped `1.1.<n> (<n>)` with `n = git rev-list --count HEAD` (shown in More → About
  and Settings); local builds use `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` from `Config/Base.xcconfig`.
* Test hooks (DEBUG builds or `TRACKIFY_UI_TEST=1`): `-TrackifyServer <url>`, `-TrackifyAutoLogin email:password`,
  `-TrackifyFreshLogin YES`, `-TrackifyResetSession YES`, `-TrackifyScreen home|stats|team|billing|chat|settings|visualizations`,
  `-TrackifyBillingTab sessions|history|rates|ai`, `-TrackifyChatPrompt "…"`; macOS: `-TrackifyShowPanelWindow YES`,
  `-TrackifyOpenDashboard YES`, `-TrackifyWindowSize 900x600`, `-TrackifyNoWindows YES`.

## Known limitations

* Unsigned builds (CI) have no App Group / Keychain entitlements: credentials fall back to App Group defaults
  and widgets can't read the app's snapshot. Sign with a team for the full experience.
* **Follow-up: APNs / push-to-start Live Activities.** The server has no push support yet (needs the owner's Apple
  Developer APNs key), so the Live Activity starts/updates from the app and from intents; a timer started on another
  device shows up when the app next runs (socket + `GET /api/timer` on foreground).
* iOS 17 simulators aren't available on the GitHub runners; the oldest OS exercised in CI is iOS 18.6.
