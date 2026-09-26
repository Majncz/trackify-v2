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
