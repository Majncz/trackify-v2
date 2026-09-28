# Trackify for Android

Native Android client for Trackify (`co.bitterlemon.trackify`). It covers everything the web app does (see
`native/docs/WEB_AUDIT.md`), and adds a few things that only make sense on a phone: an ongoing notification with a
live chronometer, home-screen widgets, a Quick Settings tile and launcher shortcuts. The contract it follows is
`native/docs/NATIVE_SPEC.md`.

- Kotlin 2.4, Jetpack Compose Material 3 with Material You: wallpaper (dynamic) colour on Android 12+, a Trackify-green
  tonal scheme on older versions, light and dark (`ui/theme/Theme.kt`; the legacy `T.c` tokens map onto M3 roles).
- minSdk 26, targetSdk 36. compileSdk is 37 because the Compose 2026.09 BOM requires it.
- Dependencies are kept lean: OkHttp, kotlinx.serialization, coroutines, DataStore, WorkManager, Glance,
  Navigation Compose and `io.socket:socket.io-client` 2.1.2. There is no Retrofit or Hilt; DI is manual (`AppGraph`).

## Build

Prerequisites: JDK 21 and an Android SDK with `platforms;android-37.0` and `build-tools;36.1.0`
(`ANDROID_HOME=/opt/android-sdk` on the workbench).

```bash
cd native/android
./gradlew :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest      # JVM unit tests (algorithms, timer queue, chat protocol)
```

### Release APK

Release builds are minified with R8 and have `shrinkResources` on. To sign them, provide the keystore through
environment variables:

```bash
set -a; . /srv/projects/trackify/workbench/lanes/native/android-signing.env; set +a
./gradlew :app:assembleRelease        # app/build/outputs/apk/release/app-release.apk
```

The variables are `TRACKIFY_KEYSTORE`, `TRACKIFY_KEYSTORE_PASSWORD`, `TRACKIFY_KEY_ALIAS` and
`TRACKIFY_KEY_PASSWORD`. You can also put `storeFile`, `storePassword`, `keyAlias` and `keyPassword` in
`native/android/keystore.properties`, which is git-ignored. If neither is present, the release APK is signed with the
debug key so that it still installs.

## Install and run

```bash
adb -s <serial> install -r app/build/outputs/apk/release/app-release.apk
adb -s <serial> shell am start -n co.bitterlemon.trackify/.MainActivity
```

The debug and release builds use the same application id but different signatures. Uninstall one before you install
the other.

## Pointing the app at a server

The app talks to `https://trackify.ranajakub.com` (live) by default. To use a different server:

1. Open **Advanced** on the login screen.
2. Enter the origin, for example `trackify-native.dev.bitterlemon.co` (`https://` is added for you).

The app stores the server per install. To switch servers later, sign out, change the value under Advanced and sign in
again. Settings → Server shows which server is in use.

Debug builds also allow cleartext HTTP to `10.0.2.2`, so the emulator can reach a local test server or proxy. For
example, `http://10.0.2.2:8788` was used to exercise the fallback for servers that don't have the new timer endpoints.

Test accounts on the lane server: `demo@trackify.test` / `trackify-demo` (seeded data) and
`native@trackify.test` / `trackify-native` (use this one for anything that creates or deletes data).

## Architecture

```
co.bitterlemon.trackify
├── TrackifyApp, AppGraph        process-wide DI container; lifecycle, network and effect wiring
├── MainActivity                 Compose host; handles shortcut intents
├── data/                        ApiClient (OkHttp), models, SessionStore (DataStore + Keystore-encrypted token),
│                                Repository (tasks cache with ETag, groups, stats, profile), SocketManager,
│                                ChatStream (AI SDK v6 UI-message SSE parser)
├── timer/                       TimerLogic (pure rules), TimerEngine (optimistic state + persisted FIFO queue +
│                                sync loop + 404 fallback), TimerSyncWorker (replay when offline),
│                                TimerRefreshWorker (15-minute truth check while running), TimerNotifier,
│                                TimerActionReceiver, QuickPickerActivity ("Switch…")
├── widget/                      WidgetSnapshot (the shared snapshot, NATIVE_SPEC §6), TeamSnapshot, WidgetKit
│                                (palette + building blocks), Timer / Timer and tasks / Team today widgets
├── tile/                        Quick Settings tile
├── util/                        Format, Accents (colour algorithms), Time, SessionRange, ChartData, StatsData,
│                                Race, Shortcuts
└── ui/                          theme, components, auth, home, task, stats, team, billing, chat, settings
```

### Timer engine

The engine implements NATIVE_SPEC §3.

1. A user action (app, notification, widget, tile or shortcut) changes local state straight away and appends an
   op (`switch`, `stop` or `adjustStart`) to a queue. The queue is persisted in `files/timer_state.json`.
2. A single sync loop replays ops one at a time:
   - 2xx drops the op.
   - 401 signs the user out.
   - 408, 429, 5xx and network errors retry with backoff (0.6 s × 1.6, capped at 8 s). A network callback, the app
     coming to the foreground and a socket (re)connect all wake the loop early.
   - Any other 4xx drops the op and shows the server's message.
3. If the process dies while ops are pending, `TimerSyncWorker` (WorkManager, needs network) replays them.
4. The engine adopts server truth (`GET /api/timer` and the socket `timer:*` events) only when the queue is empty.
5. **Compatibility:** if `/api/timer/switch` or `/api/timer/stop` answer 404 with a non-JSON body (the route is
   missing), the engine remembers that for this server and uses the web flow instead: `POST /api/events` followed by
   `DELETE /api/timer` or `POST /api/timer`. A 409 during replay counts as success when a matching event within ±2 s
   already exists.
6. A quick start followed by a stop (under 60 s) that hasn't been sent yet collapses to nothing. It never drops the
   previous task's stretch.

### Live sync

Socket.IO v4 over the websocket transport. On every connect the app sends `authenticate {token}`, and after
`auth:success` it sends `timer:request-state`. After REST task writes it relays `task:created`, `task:updated` and
`task:deleted`. The connection dot in the header turns red after an 8 s grace period.

The socket stays connected while the app is visible or a timer runs. When the app is idle in the background it
disconnects.

### Always-present surfaces

- **Ongoing notification:** chronometer, **Stop** and **Switch…** actions, and `setRequestPromotedOngoing(true)`.
  The app asks for `POST_NOTIFICATIONS` the first time you start a timer.
- **Widgets** (Glance, look of the Mac widgets): a plain neutral card (white, or near-black in dark mode; Settings →
  Appearance → Widgets can force light or dark, "System" follows dark mode without wallpaper tint), the launcher's
  corner radius, colour dots, muted secondary text and a soft red Stop. `SizeMode.Exact` with a layout per size.
  - "Timer": 2×1 (task, clock, round Stop / resume), 4×1 (task, Since, clock, Stop pill / today's total and two
    starts), 2×2 (task, Since, big clock, Stop / Not tracking, total, three starts), 4×2 (timer left, "Switch to" rows
    right).
  - "Timer and tasks": the same, and from 4×3 the Mac large layout: timer, divider, "Tasks · Today" rows (dot, name,
    today's time, ▶; the running row has a red stop) and, when tall enough, "Team · today".
  - "Team today": the team total and a row per member (initial, name, today's hours, green dot and current task
    while tracking), sorted by hours; tapping opens the Team tab. Data: the Team tab's `GET /api/presence?range=day`,
    kept in `files/widget_team.json` and refreshed on the app's presence signal (timer ops, socket
    `presence:changed` while the app or timer service is up), on foreground, when the system updates the widget and
    every 30 minutes (`TeamRefreshWorker`) — only while a widget that shows the team is placed.
  - Taps are optimistic: the action changes local state, redraws every widget and waits until they have composed the
    new state (`WidgetUpdater.redrawAndWait`, so a freeze right after can't leave a stale widget), then returns; an
    expedited `TimerSyncWorker` sends the op. The broadcast never waits for the network, so a second tap is never
    queued behind the first. Measured on the emulator with 1.5 s extra network latency: Stop visible 60–100 ms after
    the tap (was 6.3 s when tapped 2 s after a Start, up to 8 s plus a background ANR at 10 s).
  - Picker previews: `previewLayout` (Android 12–14) and generated Glance previews (Android 15+).
- **Quick Settings tile:** stops the running timer, or starts the last task.
- **Dynamic shortcuts:** the 4 most recent tasks, plus Stop while a timer runs.
- Settings → **Widgets & Quick Settings** can pin the widgets and add the tile in one tap.

### Performance and battery

- The tasks list (every event) is cached on disk and shown instantly. It refreshes in the background with
  `If-None-Match` (the server answers 304 when nothing changed), and refreshes are debounced to at least 400 ms.
- Charts are computed off the main thread (`Dispatchers.Default`) and cached per input. The 1000-day heat grid is a
  lazy list.
- Tickers and presence polling run only while a screen is visible (`repeatOnLifecycle(STARTED)`).
- Widgets redraw only when the snapshot changes.

## Tests

- `./gradlew :app:testDebugUnitTest` runs 52 JVM tests. They cover the WEB_AUDIT test vectors (group, task and race
  colours), the yearly heat levels, every formatting helper, the session-range and log-past algorithms, the heat-grid and calendar builders, the timer
  queue rules and the chat stream assembly.
- The app was also tested end to end against the lane server on emulators:
  - Pixel 8 and a small 360 dp phone, both on API 36.
  - A tablet in portrait and landscape.
  - Font scale 1.3 and 2.0, and dark mode.
  - API 26.
- Screenshots are in `native/screenshots/android/`.

## Known limitations

- Without push notifications (see SERVER_REQUESTS D2), a timer stopped on another device clears the notification in
  one of two ways:
  - immediately, if the app process is alive (the socket stays connected while a timer runs);
  - otherwise within about 15 minutes, via `TimerRefreshWorker`.
- The promoted "live update" status-bar chip depends on the device supporting promoted notifications. The app always
  requests it.
