# Phone redesign — simple, first principles

Owner feedback (2026-09-27): the phone app is a copy of the website instead of a phone app; navigation gets stuck
(Settings → tap Home does nothing); tab-change animations are noise; it's overthought. Make it as simple as possible.

## What a phone is for

1. **Start / stop / switch in one tap** and see what's running. (90 % of use.)
2. **Fix or add time** you forgot.
3. **Glance at today / this week.**
4. Occasionally: team, stats in depth, billing, AI chat, settings.

Everything is judged against that list. If it doesn't help 1–3 on the first screen, it moves off the first screen.

## Rules

- **No decoration.** No page hero titles/subtitles ("Dashboard — Track your time efficiently"), no cards inside
  cards, no transition animations between tabs (switch instantly). Platform-standard push/back for detail screens only.
- **Native patterns, not web ones:** full-width lists with dividers or plain rows, bottom sheets for dialogs, system
  back gesture/button always works, large tap targets (≥ 48 dp / 44 pt), one primary action per screen.
- **Navigation that never traps you:** each tab keeps its own stack; tapping a tab shows that tab (tapping the active
  tab pops it to its root); back always goes back. Nothing is pushed "over" the tabs except full-screen flows that
  have a clear Back.
- **Keep every feature** (web parity stays) — just put it where it belongs.

## Structure (phones; tablets use the same destinations in a rail/sidebar)

Bottom tabs: **Timer · Stats · Team · More**

### Timer (home)
Top to bottom:
1. Compact header row: "Today **5h 12m**" (live) · connection dot · `+` (new task).
2. **Running card** only when running: task name (+group), big clock, **Stop**. Tap the clock → *Fix session* sheet.
   When idle: nothing big — the list is the UI.
3. **Search field** "Start a task…": filters the list; keyboard Go / tapping "Create "x" and start" creates + starts.
4. **Task list** — plain rows, not cards: accent dot · name · today's time (muted) · trailing ▶ / ■.
   - **Tap row = start / switch** (running row shows ■ and is highlighted).
   - Row overflow (⋯ or long-press) → sheet: *Log past time*, *Details*, *Hide*.
   - Order: running first, then most recently used (web order). No "show all" collapse — it scrolls.
   - Hidden-save errors appear as a single slim banner above the list.
Leaderboard and the heat grid/calendar are **not** on this screen any more.

### Stats
Segmented Today / Week / Month / All (Custom in a menu) → total + daily average (one row) → stacked bar chart →
top tasks list → groups (list rows; create/edit in a sheet) → "Activity" (weekly heat grid + yearly calendar) at the bottom.

### Team
Leaderboard with Day / Week / Month and ‹ date › → below it a "Race" row that opens the bar-race player full screen.

### More
Plain list: **Billing**, **AI chat**, **Settings**, **Hidden tasks**, **Widgets & tile** (Android) / **Widgets** (iOS),
**About**. Each opens full screen with a Back button. Settings = account, display name, appearance (app + widgets),
notifications, security (password, delete account), server, sign out.

### Task detail (from row menu / tapping the running card's name)
Name (tap to rename) · totals · entries grouped by day (tap to edit, swipe or menu to delete) · billing section ·
Hide. Back returns to Timer.

### Sheets
Fix session, Log past time, New task, Group editor, Mark as paid, AI billing entry: bottom sheets on phones.

## Done means
- Owner's bug is gone: from any screen, tapping any tab goes there; back always works.
- Tab switches are instant (no crossfade/slide).
- Screenshots of Timer (idle, running, searching), row menu sheet, Stats, Team, More, Settings, Task detail, light+dark.
- Every existing feature still reachable.

## Android: Material You pass (2026-09-28)

Owner feedback: the Android app and widgets looked like the website. Changes:

- **Colour:** dynamic wallpaper colour on Android 12+ (`dynamicLight/DarkColorScheme`), Trackify-green tonal fallback
  below that. Tonal surfaces instead of hairlines and shadows; M3 buttons, segmented buttons, pickers, sheets, FAB.
- **Timer:** no per-row icons. Tap a row = start/switch, hold = row sheet. The running task is a primary-container hero
  (task, big clock, one big Stop; Stop sits beside the clock on short screens) and is not repeated in the list unless
  you are searching. Rows lead with a coloured initial. New task is a FAB.
- **Widgets:** no wordmark; launcher corner radius; wallpaper colours; a layout per size (2×1, 4×1, 2×2, 4×2, 4×3+);
  running task + live clock are the biggest thing; whole tiles/rows are the targets; idle = resume the last task.
- **Notification** is tinted with the task colour; the **tile** says what a tap will do.
