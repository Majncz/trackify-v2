# Trackify Native — product & engineering contract

Lane: `trackify/native` · branch `lane/native` · server https://trackify-native.dev.bitterlemon.co
Web reference: [WEB_AUDIT.md](./WEB_AUDIT.md) (every screen, endpoint, algorithm). This file says how the
native apps use it. When the two disagree about *web behaviour*, WEB_AUDIT wins; about *native behaviour*, this file wins.

Platforms: **macOS** (menu bar first), **iOS/iPadOS** (app + widgets + Live Activity), **Android** (app + widgets + ongoing
notification + Quick Settings tile). Windows later (not in scope).

---

## 1. Product idea

Trackify's job is "what am I working on right now, and how much have I done". The web app is a place you visit;
the native apps make that one question **always one glance / one tap away**:

| Platform | Always-present surface | Full app |
|---|---|---|
| macOS | Menu-bar item showing the running task + elapsed time; click → panel to start/switch/stop/fix/log. Global hotkey ⌃⌥T. Desktop widgets. | "Dashboard" window (sidebar) with every web feature. No Dock icon unless the dashboard is open. |
| iOS | Live Activity + Dynamic Island while running (with Stop). Home/Lock-screen widgets (interactive start/stop). Control Center control. Siri/Shortcuts intents. | Tabbed app with every web feature. |
| Android | Ongoing notification with chronometer + Stop/Switch (promoted "live update" chip on Android 16). Home-screen widgets (Glance). Quick Settings tile. App shortcuts. | Bottom-nav app with every web feature. |

Feature parity = everything in WEB_AUDIT §1 (Home/timer, log past, fix session, leaderboard day/week/month, time-spent
heat grid + yearly calendar, task detail + billing panel, Stats, groups, Billing (sessions/history/rates/mark paid),
AI billing, Visualizations race, AI chat with tool approvals, Settings + hidden tasks, auth incl. register & forgot
password). Natives may go *beyond* web where the API allows (edit/delete time entries on task detail, delete
conversations, change password, delete account).

## 2. Server & accounts

- Default server: `https://trackify.ranajakub.com` (live). A **Server** field (collapsed "Advanced" on the login screen)
  lets you point at another origin, e.g. the lane `https://trackify-native.dev.bitterlemon.co`. Persist per install.
- Test accounts on the lane (never on live):
  - `demo@trackify.test` / `trackify-demo` — 150 days of seeded data, groups, billing (CZK+EUR), AI billing. Use for screenshots.
  - `native@trackify.test` / `trackify-native` — near-empty; use for flows that create/delete.
  - Re-seed: `python3 native/tools/seed_demo.py https://trackify-native.dev.bitterlemon.co demo@trackify.test trackify-demo`
- Auth: `POST /api/auth/token {email,password,deviceName}` → `{token, expiresAt, user{id,email}}`. Store token + user id in
  secure storage (Keychain / EncryptedSharedPreferences-or-DataStore+Keystore). `Authorization: Bearer`. On 401 anywhere →
  signed-out state with the email prefilled. Logout = `DELETE /api/auth/token`, then wipe local data.
- Tokens now live 90 days and renew while used (lane server). Live server still has fixed 30 days — handle 401 gracefully.

### Endpoints added on this lane (see commit "API for native clients")
| Endpoint | Purpose |
|---|---|
| `POST /api/timer/switch {taskId, at?: ISO}` | Start task; if another runs, **saves its stretch up to `at`** then starts. Same task = no-op. → `{running:true, taskId, startTime(ms), event\|null}` |
| `POST /api/timer/stop {taskId?, startTime?: ISO, endTime?: ISO, name?}` | Save running stretch (≥60 s) and stop. `endTime` = stop in the past; `startTime` = "fix session then stop". Nothing running / other task → `{stopped:false, running}` (idempotent). → `{stopped, running:false, event\|null, skipped}` |
| 409 on both | `{error, overlap:{taskName,name,from,to}}` — timer left unchanged |
| `GET /api/profile` | now includes `id` |
| `DELETE /api/profile {password}` | delete account (403 wrong password) |
| `POST /api/profile/password {currentPassword,newPassword}` | change password |

**Compatibility rule (mandatory):** the live server doesn't have these yet. If `/api/timer/switch` or `/api/timer/stop`
answers **404 (route missing — HTML/non-JSON body or `{error}` without our shapes)**, fall back to the web's flow
(WEB_AUDIT §4.5): stop = `POST /api/events {taskId, from, to}` (if ≥60 s) then `DELETE /api/timer?taskId=`;
switch = that stop + `POST /api/timer {taskId, startTime}`. Note: `/api/timer/switch` 404 with JSON `{"error":"Task not found"}`
is a *real* 404 (task hidden/deleted), not a missing route — distinguish by body. Missing `profile.id` → use the id
from the token response. Account deletion/password change 404 → hide those rows.

## 3. Timer engine (identical semantics on all platforms)

State (persisted, shared with widgets/extensions):
```
running: { taskId, startTime: epochMs, pending: Bool } | null
queue:   [ Op ]   // FIFO, persisted, replayed until done
Op = switch(taskId, atMs) | stop(taskId, atMs, startOverrideMs?) | adjustStart(taskId, newStartMs)
```
- **User action → apply optimistically → enqueue → kick the sync loop.** UI never waits for the network.
  - Start/switch while running A: running = {B, now, pending}. Stretch of A is saved by the server (switch op).
  - Stop: running = null. Stretches < 60 s are silently dropped (server does it; UI shows nothing special).
  - Fix session (adjust start): `PATCH /api/timer {taskId,newStartTime}`; show 409 message inline in the dialog and
    revert. Stop-in-the-past: `stop(taskId, endMs, startOverride?)`.
- Sync loop: one op at a time. 2xx → drop op. 401 → sign out. 408/429/5xx/network → retry with backoff (0.6 s × 1.6, max
  8 s, plus on reconnect/foreground/network-available). Other 4xx → **drop the op, show the server message** as a
  transient error banner ("Couldn't save: …"), then refresh truth.
- Truth: when the queue is empty, adopt `GET /api/timer` (on launch, foreground, socket connect, after each op) and
  adopt socket `timer:started` / `timer:start-updated` / `timer:stopped`. While ops are pending, ignore socket timer events.
- After a timer op or `timer:stopped` → refresh tasks (+ stats/presence). Debounce refreshes (≥ 400 ms).
- Elapsed is always computed locally (`now − startTime`); never poll for ticks.
- Pending state is visible but calm: a subtle pulsing "Syncing…" caption (web's yellow ring equivalent), not a spinner.

Socket.IO (v4, path `/socket.io`, websocket transport): on every connect emit `authenticate {token}`; wait for
`auth:success`; then `timer:request-state`. Listen: `timer:started`, `timer:stopped`, `timer:start-updated`,
`task:created|updated|deleted`, `presence:changed` (→ refetch `/api/presence`, debounced 1 s). After REST task writes,
**emit the relay** (`task:created`/`task:updated` with the task JSON, `task:deleted` with id) so the web updates live.
Connection dot like the web: green connected, amber reconnecting, red after 8 s disconnected.

## 4. Visual language

Monochrome neutral like the web (shadcn "new-york", neutral): black primary on white; colour comes only from task/group
accents, heatmap greens, status colours. **Support dark mode** (web defines dark tokens; natives must honour the system
appearance). Tokens (light / dark):

| Token | Light | Dark |
|---|---|---|
| background | #FFFFFF | #0A0A0A |
| foreground | #0A0A0A | #FAFAFA |
| card | #FFFFFF | #111111 (slightly lifted) |
| primary / on-primary | #171717 / #FAFAFA | #FAFAFA / #171717 |
| muted (secondary surfaces) | #F5F5F5 | #262626 |
| muted-foreground | #737373 | #A3A3A3 |
| border | #E5E5E5 | #262626 |
| destructive | #EF4444 | #EF4444 (text on it #FAFAFA) |
| live/success | emerald #10B981, green #22C55E | same |
| pending | amber #F59E0B | same |

- Radii: cards 12, buttons/inputs 8 (iOS/macOS may use continuous corners), pills fully rounded.
- Type: system font (SF Pro / Roboto). Clocks & times: monospaced digits (SF Mono / `monospacedDigit()`; Roboto Mono or
  `fontFeatureSettings = "tnum"`). Running clock: bold, large (web 36 px). Brand wordmark: **"Trackify."** bold with the dot.
- Accents & palettes — reproduce exactly (WEB_AUDIT §5.3): `GROUP_COLOR_PRESETS`, `hashGroupId` (Int32 multiply, un-wrapped add, abs),
  `resolveGroupAccent`, `taskAccentHex`, chart palette `#3b82f6 #f97316 #10b981 #8b5cf6 #ec4899 #14b8a6` + Other `#6b7280`,
  heat colours `#e8eee9 #86efac #22c55e #15803d #052e16` with the percentile algorithm (§1.5.1; in dark mode level 0 = muted),
  race palette + `colorForId`, leaderboard rank colours. Unit-test these with the audit's test vectors.
- Formatting helpers exactly as WEB_AUDIT §5.4 (`formatDuration`, `formatDurationWords`, `fmtMs`, `formatHeatMinutes`,
  `formatDurationMinutes`, money with `cs-CZ` for CZK). Weeks start Monday. Billing keys are UTC.
- Icons: SF Symbols / Material Symbols equivalents of the lucide set.
- Copy: keep the web's wording (titles, empty states, error texts) so both feel like one product.
- App icon: black rounded square, white bold "T" with a green (#22C55E) dot at the lower right (the "Trackify." dot).

## 5. Platform specifics

### macOS (macOS 14+)
- `LSUIElement` app. `MenuBarExtra(.window)`. Label: idle → template glyph; running → small green dot + task name
  (≤ 18 chars, ellipsis) + elapsed `h:mm` (updates each minute; setting: show seconds, hide name).
- Panel (≈ 360 × up to 560): header (wordmark, connection dot, "Today Xh Ym", ⋯ menu: Open Dashboard ⌘D, Settings…,
  Launch at Login, Sign Out, Quit ⌘Q) → running card (name, group pill, big clock, Stop, "Fix…", "since 09:14") →
  search field "Start a task…" (filter; ↩ starts top match; no match → "Create “x” and start") → task rows (accent dot,
  name, today/total, ▶ on hover, running row highlighted; click = start/switch; context menu: Log past time…, Details,
  Hide) → compact "Live now" strip (other people tracking). Keys: ⌘1…9 start nth, ⌘. stop, ⌘F search, ⌘N new task, Esc close.
- Global hotkey ⌃⌥T toggles the panel. Launch at login via `SMAppService`.
- Dashboard window: `NavigationSplitView` sidebar Home · Stats · Visualizations · Billing · AI Chat · Settings. While open,
  activation policy `.regular` (Dock icon); back to `.accessory` when closed.
- Optional reminder: local notification "Still tracking X?" after N hours (setting, default off).

### iOS / iPadOS (iOS 17+)
- Tabs: Home · Stats · Team (leaderboard + race) · Billing · Chat. Settings from the Home toolbar (person icon).
- Live Activity (ActivityKit) while running: task name, group accent, `Text(timerInterval:)`, Stop button
  (`LiveActivityIntent`). Dynamic Island compact: accent dot + elapsed; expanded: name, clock, Stop.
- Widgets (WidgetKit, App Group shared snapshot): small (running clock + Stop / idle: last task Start), medium (running +
  4 quick-start tasks), large (running + 8 tasks + today total), accessory circular/rectangular/inline. Interactive via
  App Intents (iOS 17). Control Center control (iOS 18 `ControlWidget`, guarded by availability).
- App Intents: Start Task (TaskEntity), Stop Timer, Current Timer → Shortcuts/Siri/Action button.

### Android (minSdk 26, target/compile 36)
- Bottom nav: Home · Stats · Team · Billing · Chat. Settings from the top bar.
- Ongoing notification while running: task name, chronometer, actions Stop & Switch… (opens quick picker);
  `setRequestPromotedOngoing(true)` on API 36 (status-bar chip). Actions run through the timer engine (WorkManager for
  retry when offline).
- Glance widgets: small (timer + Start/Stop), large (running + task list with start buttons). Quick Settings tile
  (tap = stop / start last task). Dynamic app shortcuts for the 4 most recent tasks.
- Material 3 with the Trackify neutral palette (no dynamic colour), light/dark.

## 6. Shared snapshot for widgets/extensions
```
{ signedIn, serverUrl, userId, updatedAt,
  running: {taskId, taskName, accentHex, startTime} | null,
  todayTotalMs,            // completed events today (local) — add live part at render time
  tasks: [{id, name, accentHex, todayMs, totalMs}] (top 8 by sort order of Home) }
```
Written by the app after every refresh/timer change; widgets render from it and call the timer engine for actions.

## 7. Quality bar
- No spinners for timer actions; everything optimistic; offline works (queue) and heals.
- Every screen has loading (skeleton), empty and error states with the web's wording.
- Accessibility: Dynamic Type / font scale, VoiceOver/TalkBack labels on icon buttons, 44 pt / 48 dp targets.
- Screenshots of every screen in light + dark are part of the test pass (`native/screenshots/<platform>/`).
