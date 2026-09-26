# Server requests from the native lanes

Append-only. The lead implements and replies.

## Apple (iOS/macOS) — 2026-09-26

### A1. Persist tool-call inputs in chat history (WEB_AUDIT G14)
`POST /api/chat` saves assistant tool parts with `input: {}` (reads `tc.args`, AI SDK v6 uses `tc.input`).
Reloaded conversations therefore show tool lines without arguments ("Log time to a task ()").
Please store `input` from `tc.input`. Native works around it by showing just the tool label when input is empty.

### A2. (Nice to have) APNs device registration for Live Activities (WEB_AUDIT G10)
To keep the iOS Live Activity / lock-screen widget in sync when the timer is started or stopped on another
device while the app is not running, the server would need `POST /api/devices {apnsToken, liveActivityPushToken?, platform}`
and to send ActivityKit push-to-start/update/end on `timer:started|stopped|start-updated`. Today the app updates the
Live Activity itself whenever it runs (foreground, intents, widget taps), which covers single-device use.
Not blocking.

### Lead replies
- **A1 — done** in 81b0423 (`input: tc.input ?? tc.args`, `output: toolResult.output ?? toolResult.result`). New conversations on the lane keep arguments; rows saved before stay `{}` — keep the label-only fallback.
- **A2 — deferred.** Needs an APNs auth key (.p8) from the owner's Apple Developer account; can't be created from here. Documented as a follow-up in the Apple README; single-device behaviour is fine.

## Android — 2026-09-26

### D1. Keep un-answered approval tools as `input-available` when persisting chat (WEB_AUDIT G14)
`onFinish` in `POST /api/chat` stores every tool call as `state: "result"` even when no tool result exists
(write tools waiting for Approve/Reject). After reopening a conversation, clients can't tell a pending approval
from a finished call, and re-sending that history makes `convertToModelMessages` see a tool call without output.
Please store `state: "input-available"` (and no `output`) when `toolResult` is missing.
Android meanwhile drops such parts when it re-sends history and shows them as plain tool lines.

### D2. (Nice to have) FCM registration for the ongoing timer notification (WEB_AUDIT G10)
Same idea as A2 for Android: `POST /api/devices {fcmToken, platform:"android"}` and a data message on
`timer:started|stopped|start-updated`. Today the app keeps a socket open while a timer runs and the process is alive,
and WorkManager/`GET /api/timer` heal the notification on the next launch, but if Android kills the process and the
timer is stopped on the web, the notification stays until the app runs again. Not blocking.
- **D1 — done.** Tool calls without a result are persisted as `state:"input-available"` with `input` and no `output`
  (the web already renders that as a pending approval card).
- **D2 — deferred** (needs a Firebase project + server key from the owner). Meanwhile: while the ongoing notification is
  shown, schedule a periodic WorkManager check (15 min, network-connected) of `GET /api/timer` that clears/updates the
  notification — heals a web-side stop within ~15 min without push.
