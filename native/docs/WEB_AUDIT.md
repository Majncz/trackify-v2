# Trackify: native client parity spec (web audit)

Audited: `/srv/projects/trackify/prod` working tree as it stood on 2026-09-26 (HEAD `664866d`, with uncommitted changes). This was a read-only audit: no file in that tree was modified.
Stack: Next.js 14.2 App Router, a custom HTTP + Socket.IO 4.8 server (`server/index.ts`), Prisma/Postgres, next-auth v5 beta (JWT sessions), AI SDK v6 (`ai`, `@ai-sdk/anthropic`, model id `claude-sonnet-5`), zod v4, date-fns v4 / date-fns-tz v3, recharts 3.
Production is `https://trackify.ranajakub.com` and dev is `https://dev.trackify.ranajakub.com`. In production, `npm start` runs `node dist/server/index.js` on port 3000, which serves both Next and Socket.IO from the same origin under the path `/socket.io`.

> **Legend: `[UNCOMMITTED]`** marks a feature or field that exists only in the uncommitted working tree (`git status`), meaning it is not in HEAD and so not necessarily deployed. The uncommitted set is:
> - `src/app/(dashboard)/visualizations/` (new page)
> - `src/app/api/visualizations/` (new API)
> - `src/components/visualizations/`
> - `src/hooks/use-race-data.ts`
> - `src/lib/bar-race.ts`
> - `src/lib/period-window.ts`
> - modifications to `api/presence/route.ts` (adds a `range` query param plus `range`/`isCurrent` response fields; HEAD supports day only)
> - `hooks/use-presence.ts`
> - `components/team/daily-leaderboard.tsx` (the Daily/Weekly/Monthly toggle)
> - `lib/live-timer.ts` (`liveRangeMs`)
> - `layout.tsx` (title "Trackify" changed to "Trackify.")
> - `header.tsx` / `bottom-nav.tsx` (Viz nav item, and Settings active highlight in the header)

---

## 0. TL;DR for native devs

- **Auth:** `POST /api/auth/token {email,password}` returns `{token, expiresAt(30d), user{id,email}}`. Send `Authorization: Bearer <token>` on every call. **Every** data endpoint uses `getAuthUser` (session OR Bearer). The only routes without auth are the public ones: register, forgot/reset password, `GET /api/chat/model`, and next-auth.
- **Socket:** connect to the same origin with path `/socket.io` and emit `authenticate {token}`. The server replies `auth:success {userId}`, or `auth:error {message}` followed by a disconnect. **Token auth is supported.**
- **The server never creates a time entry when a timer stops.** Saving the stretch as an `Event` is always the client's job (`POST /api/events`). The server only tracks *which task is running and since when* (the `ActiveTimer` row plus an in-memory map).
- **Minimum session length is 60 s (`MIN_EVENT_MS`).** Shorter stretches are dropped by the client, skipped by the server (201 `{skipped:true}`), and deleted as "crumbs" when they overlap a later write.
- **Events never overlap per user.** Writes return 409 with a human message.
- Nearly everything the UI shows (totals, charts, heatmaps) is **computed client-side** from `GET /api/tasks`, which returns every task with *all* its events. The exceptions are billing sums, AI analytics, presence/leaderboard and race, which the server computes.
- The web UI is **light-mode only in practice.** Dark tokens exist, but nothing ever adds the `.dark` class.

---

## 1. Screens and features

### 1.0 App shell (`src/app/(dashboard)/layout.tsx`)
- Server-side session check; no session redirects to `/login`.
- Wraps everything in `SocketProvider` and then `TimerProvider` (a single global timer state).
- **Header** (fixed, height 56 px, `bg-background/95` with backdrop blur, bottom border):
  - Brand "Trackify." (the trailing dot is uncommitted; HEAD says "Trackify"), bold `text-lg`.
  - Beside the brand is a 6 px **connection dot**:
    - green `bg-green-500` with a glow and a 2 s scale/opacity pulse = connected
    - amber `bg-amber-400` = reconnecting
    - red `bg-red-500` with a slow pulse = disconnected
  - Red is shown only after an **8 s grace period** (`RED_GRACE_MS`). Tooltip text is "Connected" / "Reconnecting" / "Disconnected".
  - Desktop only: icon buttons for Stats (BarChart2), Visualizations (Clapperboard) `[UNCOMMITTED]`, Billing (DollarSign) and Settings. The active route is tinted `text-primary`.
- **Bottom nav** (mobile, below 768 px; `bg-card`, top border, height 56 px): Home, Chat, Stats, Viz `[UNCOMMITTED]`, Billing, Settings.
  - Each item is a lucide icon at 20 px with an xs label.
  - The active item is `text-primary`; the others are `text-muted-foreground`.
- Content column: `max-w-4xl` (896 px), centred, padding 12/16/32 px.
- **Desktop AI chat sidebar:**
  - A floating round button (48 px, bottom-right) toggles a 384 px right panel below the header, sliding in over 300 ms.
  - The sidebar is hidden on `/chat`.
- Global React Query defaults: `staleTime 60s`, refetch on window focus.

### 1.1 Auth screens (`src/app/(auth)`)
All are centred cards, max-width 448 px.
- **Login** (`/login`):
  - Fields: Email, Password, plus a "Forgot password?" link that carries `?email=`.
  - Uses the next-auth credentials provider.
  - Error texts come from the provider codes: `"No account found with this email"` and `"Incorrect password"`. The generic fallback is "Invalid credentials".
  - Password verification accepts bcrypt (`$2…`) **and legacy unsalted SHA-256 hex (64 chars)**. See gap G3: the token endpoint accepts only bcrypt.
  - Success routes to `/`. A "Register" link is provided.
- **Register** (`/register`):
  - Fields: Email, Password, Confirm.
  - Client checks: passwords match, length ≥ 6.
  - Calls `POST /api/auth/register`, then redirects to `/login?registered=true`. No banner is shown for that flag, and no auto-login happens.
- **Forgot password** (`/forgot-password`): Email field; `POST /api/auth/forgot-password`. Always shows "Check your email for a reset link".
- **Reset password** (`/reset-password?token=…`): new password plus confirm, length ≥ 6; `POST /api/auth/reset-password`. The email link points to `${NEXTAUTH_URL}/reset-password?token=…` and expires in 1 h.
- **Logout:** Settings, then "Sign out" (next-auth signOut). The native equivalent is `DELETE /api/auth/token`.

### 1.2 Dashboard `/` (Home)
Sections, top to bottom:
1. Title "Dashboard", subtitle "Track your time efficiently", and a **New Task** button (plus icon) that opens a dialog:
   - Title "Create New Task", with an input "Enter task name..."
   - Buttons: Cancel, and "Create Task" (shows "Creating..." while pending)
   - Calls `POST /api/tasks`, then emits socket `task:created` with the created task
2. **Leaderboard card** (`DailyLeaderboard`; see 1.9).
3. **Task list** (`TaskList`), described below.
4. **Time Spent chart** (`TimeChart`; see 1.4). It is hidden when there are no visible tasks.

**Task list behaviour**
- **Save error alert:**
  - A destructive alert titled "Failed to save" appears when a queued stop or start was rejected by the server (`createEventError`).
  - It can be dismissed with an X.
- **Active timer banner** (shown only while running):
  - Card styling: `border-primary bg-primary/5`.
  - Kicker text: "Currently tracking", or "Syncing..." while `pendingConfirmation` (the whole card then pulses: opacity 1 to 0.4 over 1.5 s).
  - The task name.
  - A big clock `HH:MM:SS` (monospace, bold, 36 px, tabular digits; ticks every 100 ms). **Tapping the clock opens "Fix this session"** (see 1.3.3).
  - A destructive **Stop** button that reads "Saving..." while any stop is queued.
- **"Tasks (N)"** grid:
  - Columns by width: 1 (<640), 2 (<1024), 3 (<1280), 4.
  - **Collapsed to 2 rows** by default, with a "Show All (N more)" / "Show Less" toggle.
  - Empty state: "No tasks yet. Click "New Task" to get started!"
- **Sort order:**
  1. The running task first.
  2. Tasks with **no events** next.
  3. The rest by most recent event `from`, descending.
- **Task card** (`rounded-xl`, border, `shadow-sm`, padding 16):
  - Title: the name, truncated.
  - Group pill on the right, if the task is grouped: `rounded-xl`, 1 px border in the group accent at 92 % alpha, text in the accent colour, font 10 px medium, max width about 11 rem.
  - "Total: {formatDurationWords(allEvents + live)}".
  - Buttons:
    - **Start** (Play icon, primary), or **Stop** (Square icon, destructive, reads "Saving..." / "Syncing..." when pending).
    - A small outline **+** button ("Add time that already happened") that opens **Log past time** (1.3.4).
  - Active card: `ring-2 ring-primary` with a 2 px offset.
  - Pending save or confirmation: yellow ring (`ring-yellow-500`) plus the pulse.
  - Tapping the card elsewhere opens `/tasks/:id`.
  - Starting another task while one runs is a **switch** (1.3.2).

### 1.3 Timer UX

#### 1.3.1 Start / Stop
- **Start** sets the timer locally at once, with `startTime = Date.now()`, then persists it in the background. The UI shows "pending" until the server confirms. Details in §4.
- **Stop** closes the stretch `[startTime, now]`:
  - If the stretch is 60 s or longer, it is queued for saving as an Event.
  - If it is shorter, it is silently discarded.
  - The UI goes idle immediately.

#### 1.3.2 Switch
Pressing Start on task B while A runs is a switch:
1. Stop A at t (the stretch A `[a0, t]` is saved if ≥ 60 s).
2. Start B at the same t.

There is no gap and no confirmation.

#### 1.3.3 "Fix this session" (adjust running timer), `adjust-timer-dialog.tsx`
- Opened by tapping the running clock.
- The header shows the duration (`formatDurationWords`, monospace, 36 px). Under it:
  - "Started HH:mm · still running", or
  - "Started HH:mm · stopped HH:mm".
- **Session range slider** (1.3.5):
  - The start knob sets the new start.
  - The end knob sits at "Now" (live). Dragging it left sets a past stop time. Dragging it back to within 30 s of the right edge returns it to live.
  - `viewTo = openedAt` (the moment the dialog opened); `earliest = openedAt − 40 h`.
  - Busy spans are all events of all tasks.
- **Time fields**, each a button showing `HH:mm` that opens hour and minute wheels:
  - "Started": clamped by `clampTypedStart`.
  - "Until · now" / "Until": clamped by `clampTypedEnd`.
  - A caption under each shows `agoLabel` ("now", "N min ago", "1 hour ago", "Nh Mm ago").
  - If the picked time could not be applied, the caption reads "That time overlaps other work".
- **Save button**:
  - Still running: "Save start time". The new start is snapped to the whole minute if it moved at least 500 ms, then flows through `POST /api/timer/validate-start` and then `PATCH /api/timer`.
  - End set: "Stop {agoLabel(end)}" (e.g. "Stop 12 min ago"). This stops the timer with a past end: the stretch `[start, snapMinute(end)]` is queued as an Event, and the timer is deleted.
- Error text appears inline in the destructive colour. Outside clicks close the dialog, except during or just after a slider drag (500 ms guard).

#### 1.3.4 "Add time to {task}" (log past time), `log-past-dialog.tsx`
- Opened from the **+** on a task card.
- **Initial suggestion** (`suggestPastRange`):
  - Preferred length = the **median** of this task's event durations between 1 min and 8 h (default **25 min**).
  - Lookback is 40 h. Busy = all events of all tasks plus the running timer (`[runningStart, now]`).
  - Walk the free gaps (≥ 1 min) **from latest to earliest**:
    - If a gap holds the preferred length, take the last `preferred` of it (ending at `gap.to`).
    - Otherwise, if the gap is ≥ 1 min, take the whole gap.
  - Fallback: `[now − preferred, now]`.
- **View window** (`viewAround`):
  - The span is `max(90 min, duration + 20 min)`, centred on the range and clamped to `[now − 40h, now]`.
  - It is widened by 10 min if the range sticks out.
- Header: the duration, then "HH:mm → HH:mm", or "→ just now" if the end is within 90 s of opening.
- **Slider in `placeInGaps` mode:**
  - Tap an empty (non-busy) spot on the track to **relocate** the whole range, keeping its duration, into the nearest gap at that time.
  - Drag the empty track (more than 10 px) to **pan** the view.
  - Drag the knobs to resize; they cannot cross busy blocks.
- **Time fields** "From" / "Until": picking a time relocates the range into the nearest gap. "Until" anchors the end.
- **Save:** "Add {duration}" sends `POST /api/events {taskId, from: snapMinute(start), to: snapMinute(end), name:"Time entry", source:"manual"}`.
  - 409 errors show inline.
  - Note: if the result is under 60 s, the server returns 201 `{skipped:true}` and the dialog closes as if it succeeded.

#### 1.3.5 Session range slider, `session-range-slider.tsx`
Constants:

| Constant | Value |
|---|---|
| `MIN_DURATION` | 1 min |
| `MAX_LOOKBACK` | 40 h |
| `FIRST_VIEW` | 90 min |
| Hit target | 44 px |
| Knob | 28 px, white, shadow `0 1px 3px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.08)`; while active `0 2px 8px rgba(0,0,0,.22), 0 0 0 5px rgba(0,0,0,.08)` |
| Track height | 6 px |
| Track centre | 40 px from top |
| Horizontal inset | 18 px |
| Component height | 64 px |

Visual layers, bottom to top:
1. The track, `bg-muted`, fully rounded.
2. Busy blocks: `neutral-400` at 70 % alpha, minimum width 3 px, with a title tooltip "Task: entry name".
3. The selected range, in the `foreground` colour.
4. The knobs, each with a monospace xs time label above it:
   - The end label reads "Now" when live.
   - When the knobs are closer than 64 px, the labels move apart (start label to the left, end label to the right).

`initialViewFrom(start, openedAt)`:
- If the running duration is ≥ 90 min: `max(earliest, start − 20 min)`.
- Otherwise: `max(earliest, openedAt − 90 min)`.

Clamping rules (exact):
- `minStartForEnd(end)`: `min = earliest`; for every busy span with `from < end`, set `min = max(min, span.to)`. The start therefore cannot cross the end of any earlier block.
- `maxEndForStart(start)`: `max = latest`; for every busy span with `to > start`, set `max = min(max, span.from)`.
- Start ∈ `[minStartForEnd(end), end − 1 min]`. End ∈ `[start + 1 min, maxEndForStart(start)]`.

Drag behaviour:
- A pointer-down within 44 px of a knob grabs the closer knob.
- Otherwise:
  - In place-in-gaps mode, it "arms" a tap: a move of more than 10 px becomes a pan, and a release relocates the range.
  - Otherwise, it grabs whichever knob is closer.
- Positions are snapped to the minute on release. They are continuous while dragging.
- **Edge auto-scroll:**
  - Dragging start within the left 7 % pans the view earlier at 6 h/s (and moves start with it).
  - Dragging end within the right 93–100 % pans later.
  - Both are bounded by earliest, busy blocks and the horizon.
- Wheel time picker (`SessionStampField`):
  - Hours 00–23 and minutes 00–59.
  - A picked `HH:mm` resolves to the nearest candidate day among offsets `[0, −1, +1, −2]` that lies within `[min, max]`, otherwise it is clamped.

### 1.4 Home "Time Spent" chart (`components/stats/time-chart.tsx`)
There are two toggle buttons: **Weekly** (the default) and **Yearly**. The live timer is included as a synthetic event `[startTime, now]`, refreshed every 10 s.

**Task colours** (`TASK_COLORS`): `#3b82f6, #f97316, #10b981, #8b5cf6, #ec4899, #14b8a6`. "Other" is `#6b7280`.
- Weekly mapping:
  - Take the **top 5 tasks by time in the 10-day window ending today** (`[today−9, today]`). Rank *i* gets `TASK_COLORS[i]`.
  - The rest map to Other.
  - The live task, if not in the top 5, gets its yearly colour.
- Yearly mapping: the visible tasks sorted by name (API order); index *i* gets `TASK_COLORS[i % 6]`.

**Weekly** (despite the name, this is a scrollable day × hour heat grid):
- Rows are the last **1000 days**, oldest at the top. It auto-scrolls to the bottom (today).
- Viewport is 240 px, virtualised with 5 buffer rows.
- Row label: "MMM d" (52 px column, 11 px text).
- Hour header ticks at 0, 6, 12 and 18 (9 px).
- Each hour is split into `squaresPerHour` squares (1–6). The count is chosen so the square size is closest to 12 px (minimum 10 px, gap 2 px, 24 hours × sph columns). If nothing fits, sph = 1 with size `max(8, …)`.
- **Per-hour cell:**
  - Total minutes and per-task minutes come from the overlap of each event with that hour.
  - All squares in an hour take the colour of the hour's **dominant task**, i.e. the task with the most minutes (unknown tasks map to Other).
  - Empty cells use the `muted` colour.
- **Opacity:**
  - Has time: `0.2 + (min/maxMin)^0.4 × 0.8`, where `maxMin` is the maximum over the whole grid.
  - Empty: 0.7.
  - A *bridged* empty square inside a segment: 0.42.
- **Segments:**
  - A run of consecutive squares with the same dominant task.
  - A run of empty squares is absorbed ("bridged") if it is at most `max(squaresPerHour, 2)` squares long, the task on the other side is the same, and it is not at the end of the day.
- Hovering a segment shows a tooltip card (236 px):
  - Line 1: the date, "EEEE, MMMM d, yyyy".
  - Line 2: "d.M.yyyy".
  - The precise task window inside the segment, "HH:mm:ss → HH:mm:ss" (or the grid bounds followed by "(grid)").
  - A colour dot, the task name, and the minutes (`formatHeatMinutes`).
  - "Short gap in this streak: X with no logged time", if the segment bridged any squares.
  - A Copy button that copies a plain-text version beginning with the line "Trackify - time segment".
- Header: up/down chevrons scroll 120 px. A static label reads "MMM d - MMM d, yyyy" (the whole 1000-day range).
- A legend of task colours sits below.

**Yearly:** the GitHub-style contribution calendar (1.5.1). Left/right chevrons scroll 120 px; the label is "Yearly Calendar".

Empty state: "No data for this period".

### 1.5 Stats page `/stats` (`stats-page-client.tsx`)
Title "Stats", subtitle "Analyse your tracked time". Data comes from `useTasks()` (visible tasks only), including the live timer (1 s tick).

**Range buttons:** Today | **Week** (the default) | Month | All Time | Custom.
- Week is Monday-based.
- Custom shows two date inputs, defaulting to this week's Monday–Sunday.
- Ranges use local `startOfDay` / `endOfDay`. All Time has no bounds.

**Headline cards (2):**
- **Total Tracked:** the sum of event overlap with the range, formatted by `fmtMs`. `fmtMs` has these cases:

  | Condition | Output |
  |---|---|
  | ms ≤ 0 | "0s" |
  | hours and minutes both non-zero | "Xh Ym" |
  | hours only | "Xh" |
  | minutes and seconds both non-zero | "Ym Zs" |
  | minutes only | "Ym" |
  | otherwise | "Zs" |

- **Daily Average** ("per active day"): total ÷ the number of distinct local days (by the event's **from** date) among events overlapping the range.

**"Daily breakdown" stacked bar chart** (shown only when there is data):
- Height 208 px.
- Bars:
  - Per day if the range spans ≤ 42 days.
  - Otherwise per Monday-week, with the label "MMM d" of the Monday and the detail "Week of MMMM d, yyyy".
- For All Time, the range runs from the earliest event through today (or the last 30 days if there are none).
- Series: the **top 5 tasks in the range** use `TASK_CHART_HEX[i]` (the same 6 colours) at alpha 0.84. "Other" is `#6b7280` at alpha 0.72.
- Bar styling: stroke in the background colour at 1.5 px, radius 2, max bar width 21 px, category gap 26 %.
- Grid: dashed horizontal lines only. Y ticks read "Nh".
- Tooltip (positioned above the bar top):
  - The date detail ("EEEE, MMM d, yyyy"), "d.M.yyyy", and "Day total · X".
  - Rows sorted by value: "Task — pct% · duration".
  - A Copy button copies the plain text.

**"Top tasks" card:** ranks 1–5 with the name, `fmtMs`, and a 6 px progress bar at width `ms/total`. Colour is `TASK_CHART_HEX[i]` at alpha 0.88, radius 3.

**"Saved groups" card** (task groups):
- If 2 or more groups have time: a horizontal bar summary. Bars are sorted desc, widths are relative to the max, and each bar uses the group accent (`resolveGroupAccent`) at alpha 0.85.
- **Table:** Group | Tasks | Total | actions.
  - Each member row shows the task name ("(hidden)" suffix if hidden), a mini bar (percent of the group total, colour `TASK_CHART_HEX[memberIdx]`), and `fmtMs`.
  - Missing task ids are shown as "Removed · {first 8 chars}…" in amber. This includes hidden tasks, because `/api/tasks` excludes hidden ones.
  - "No tracked time" appears if the total is 0.
  - **Group totals are ALL-TIME, regardless of the selected range.** Only the dialogs' per-task numbers use the range.
- Row actions:
  - **Copy:** text in the form `"{group} — {total}\n  · {task}: {t}"`, plus `"  · N removed task(s) (no longer in app)"` where applicable.
  - **Edit.**
  - **Delete:** immediate, no confirmation.
- "Copy all" appears when there are 2 or more groups; groups are separated by blank lines.
- Empty state: "No saved groups yet." with a button "Create a group from tasks". The same button always appears below the card.

**Create / Edit group dialog:**
- Fields: name, then **Group colour**.
  - Mode **Auto** sends `color: null`, and the UI derives the colour from the group id.
  - Mode **Custom** requires one of the 10 preset swatches.
  - Create defaults to Custom with a **random preset**.
  - In Auto mode the grid is dimmed: in Edit it previews the derived colour; in Create it previews `#94a3b8`.
- A filter box, and (Create only) "Select all in list" / "Clear selection" with "N matches".
- Task checklist: name, a badge with the current group name, a "Hidden" badge, and the time in the range.
- **A task already in another group is disabled.** A task may belong to at most one group; the server enforces this with a 409.
- Footer (Create only): "N tasks selected · total".
- Save validates: name non-empty, at least 1 task (Create), and colour matching `^#[0-9A-Fa-f]{6}$` if Custom.

#### 1.5.1 Yearly contribution calendar (shared by Home Yearly and Billing)
Built by `buildYearlyContributionFromEventsByDate`:
- Columns are weeks, **Monday first**. They run from the Monday of the week of the **earliest event** through the Sunday of the current week (or of `calendarEndDay`).
- Rows are Mon…Sun.
- Cell value = minutes of event overlap with that local calendar day.
- Cell size 12 px, gap 2 px.
- Month labels (9 px) appear above the first week column whose Monday's month differs from the previous column.
- Day labels (9 px) show only Mon, Wed, Fri and Sun (every even row index).
- The grid auto-scrolls to the right end.
- The empty-data variant runs from the Monday of the week containing Jan 1 of the current year.

**Colour algorithm** (`lib/yearly-heat-color.ts`, exact):
```
COLORS = ["#e8eee9", "#86efac", "#22c55e", "#15803d", "#052e16"]   // level 0..4
working = sorted ascending list of all day values > 0 in the whole grid
percentile(p) = working[min(n-1, max(0, ceil(p*n) - 1))]
level(minutes):
  if minutes <= 0 -> 0
  level = 1
  if minutes >= 180 -> 2
  if minutes >= 330 -> 3      // 5.5 h
  if minutes >= 480 -> 4      // 8 h
  if n >= 8:
     p75 = percentile(0.75); p90 = percentile(0.90)
     if p90 > 0 and minutes >= p90 -> level = 4
     else if p75 > 0 and minutes >= p75 -> level = max(level, 3)
  return level
```
- Legend: "Less", the 5 swatches, "More" (10 px text, right-aligned).
- Tooltip: the date "EEEE, MMMM d, yyyy", "Total for this calendar day", "X total" (via `formatHeatMinutes`), then per-task rows sorted desc, each with a colour dot.
- `formatHeatMinutes` output:
  - "Hh Mm Ss" when there are hours, "Mm Ss" when there are minutes, otherwise "Ss".
  - Values under 1 s print fractional seconds.
  - Non-positive values print "0s".

### 1.6 Task detail `/tasks/:id`
- The task is looked up in the cached `GET /api/tasks` list, so **hidden tasks show "Task not found"**. A "Back" button returns to the previous screen.
- **Header card:**
  - **Tap the name to rename inline.** Enter or blur saves via `PUT /api/tasks/:id {name}` and emits socket `task:updated`; Esc cancels.
  - **Hide** button (EyeOff): confirm "Hide this task? You can restore it from Settings.", then `DELETE /api/tasks/:id` (a soft hide that also deletes an ActiveTimer for this task), then emits socket `task:hidden` (no server handler) and `task:deleted`, then navigates home.
  - Group badge: the accent-coloured text on the accent at 20 % alpha.
- **Body:**
  - "Total Time" (`formatDurationWords`, 2xl).
  - "Tracking Sessions" (count).
  - **Time Entries**, grouped by local day of `from`, newest first:
    - Day label: "Today", "Yesterday", or "EEEE, MMMM d, yyyy", with "{total} total".
    - Rows: "h:mm a → h:mm a" and a duration badge (mono).
    - The first 5 days are shown, then a "Show N More Days" toggle.
  - **Entries are read-only in the web UI.** There is no edit or delete; the only path is AI chat.
- **Billing & rates panel** (`TaskBillingPanel`):
  - A card with a 3 px left border in the accent colour (group accent, or `taskAccentHex(task.id)` if ungrouped) and a background of the accent at 4 % alpha (billing on) or 6 % (off).
  - Badges: group or "Ungrouped", and "Billing on" or "Not billing".
  - Stats: "Tracked time" (the sum of floor-minutes per event, `formatDurationMinutes`) and "Est. at current rate" (the sum of per-event earnings; "—" if not billing).
  - Not billing: inputs "Hourly rate" (default "50") and "Currency" (default CZK). "Add to billing" sends `POST /api/billing/tasks {taskId, hourlyRate, currency, roundingMins:0}`.
  - Billing: the rate input saves on blur (`PATCH` when changed and ≥ 0). Changing the currency select PATCHes immediately.
  - Trash icon: confirm "Remove this task from billing? Paid history stays linked to past sessions.", then `DELETE /api/billing/tasks/:billingTaskId`.
  - "Open Billing" link.

### 1.7 Billing `/billing` (`components/billing/*`)
Subtitle: "Rates on tasks, billable sessions, and marking them paid…".
- **SummaryBar:** for each currency in `GET /api/billing/summary`.byCurrency (sorted by code), a row of 4 cards:
  - **Unpaid (CUR)** (highlighted: `border-primary/40 bg-primary/5`)
  - This week
  - This month
  - All time paid

  Empty state: "Enroll tasks in billing to see earnings summary."
- A "Set up billing first" card appears when no task is enrolled; its button goes to the Rates tab.
- **"How billing works" guide:** dismissible. It is persisted in localStorage `billing-guide-dismissed=1`.
- **Tabs** (a 4-column segmented control; the panels slide horizontally over 500 ms with easing `cubic-bezier(0.22,1,0.36,1)`): **Sessions | History | Rates | AI billing**. The URL hash `#ai-billing` or `#ai-tools` opens AI billing.

**Sessions tab**
- **Filters toolbar:**
  - **Period:** This week | This month (default) | Last month | All time | Custom… (local week/month boundaries sent as ISO `from` / `to`; Custom uses `T00:00:00` / `T23:59:59.999` local).
  - **Group:** All groups | Ungrouped (only if any enrolled task is ungrouped) | each group of the enrolled tasks.
  - **Task:** All enrolled | enrolled tasks, filtered by the group choice. Changing the group resets the task to "all".
  - **Status:** Unpaid (default) | All | Paid.
  - **"Group list by":** Day (default) | Week | Month.
- Data source: `GET /api/billing/sessions?from&to&status&taskGroupId&taskId`.
- **Ledger:**
  - Sections keyed by `groupDay` / `groupWeek` / `groupMonth` (**UTC keys**, e.g. "2026-09-26", "2026-W39", "2026-09"; the raw key is the label), in server order (`from` desc).
  - Section header: a collapse chevron, the key, "{min} total", "{money} unpaid" per currency, and a "Group" checkbox that selects all unpaid rows in the section.
  - **Sticky selection bar:**
    - Help (?) tooltip.
    - Summary "N · duration · money per currency", or "Nothing selected · N unpaid in list.", or (Paid filter) "Paid-only view — selection disabled."
    - Warning "Multiple currencies — narrow selection to one currency."
    - Button "All unpaid (N)" / "Clear all" toggles every unpaid row in the list.
    - **"Mark as paid…"** is enabled only when the selection is non-empty and single-currency.
  - **Session row:**
    - Checkbox (disabled if paid).
    - Task name and group badge.
    - "MMM d, yyyy · HH:mm–HH:mm".
    - "Paid MMM d, yyyy" if paid.
    - On the right: a duration badge, the money (semibold), and a "Paid" (filled) or "Unpaid" (outline) badge.
    - Tapping an unpaid row toggles its selection.
    - Background is the accent at 12 % alpha. When selected: border accent at 55 %, bg accent at 22 %, and ring shadow `0 0 0 1px accent@.35, 0 2px 8px -2px accent@.2`.
  - Empty state: "No sessions in this range. Try another filter or enroll a task."
- **Activity calendar:** a collapsible `<details>` marked "(optional)". It holds the same yearly calendar built from the *filtered billing sessions*, where each day's value = `(overlap/sessionLength) × billed minutes`. The grid ends at the filter's end day, or today for All time.
  - Tooltip: "X · money" and per-task rows; "Click to filter the ledger to this day".
  - Clicking a non-future day sets Period to Custom = that day, Status to All, and switches to Sessions.
  - Task colours: the group accent, or the task accent.

**Mark as paid dialog**
- Header: "N sessions · duration · total".
- Per-line list:
  - Task, group, time range, duration badge, and "Calc {earnings}".
  - An **editable amount** input (decimal, comma accepted, ≥ 0, rounded to 2 dp), prefilled with the calculated earnings and followed by the currency symbol.
  - An invalid line shows "Enter a valid amount (0 or more)."
- "Reset to calculated" restores the prefilled values.
- **Paid on** (date, default today) and **Paid at time** (time, default now) are combined as local time, converted to ISO.
- **Note** (optional, max 2000, placeholder "Invoice #, reference…").
- "Total to record" = the sum of the lines.
- Submit sends `POST /api/billing/payments {eventIds, paidAt, note?, lineAmounts: {eventId: amount}}`.

**History tab** (`GET /api/billing/payments`)
- One card per payment:
  - Total money (lg) and "MMM d, yyyy · HH:mm" of `paidAt`.
  - "N sessions" badge, total duration, and the note.
  - A trash button, **"Reopen payment?"** with the text "Sessions will become unpaid again.", which calls `DELETE /api/billing/payments/:id`.
- "Sessions in this payment" lines:
  - Task, group, "Session …" (same-day form "MMM d, yyyy · HH:mm–HH:mm", else "MMM d, yyyy HH:mm → MMM d, yyyy HH:mm"), "Marked paid …", "Duration …", and the amount on the right.
  - If there are no lines (the task was unenrolled since), it shows "No line items could be computed…".
- Empty state: "No payments recorded yet…"

**Rates tab** (`TaskEnrollmentSheet`)
- Lists every **visible** task, enrolled ones first, then alphabetical.
- Each task card has a tinted background (the accent at 5 % if on, 8 % if off). It shows the name, group or "Ungrouped" badge, "Billing on" / "Not billing", and "Tracked {min} · Est. {money} at current rate".
- It carries the same enrol, edit, and remove controls as the task detail panel.
- An explainer box is shown above the list.

**Money formatting:**
- `Intl.NumberFormat(locale, {style:"currency", currency})`, with locale `cs-CZ` for CZK (e.g. `1 234,50 Kč`) and the system locale otherwise.
- `currencyUnitLabel` = the currency symbol part ("Kč", "€", "$").
- `formatDurationMinutes`: "Xh Ym", "Xh" or "Ym".

**Currencies in the picker:**

| Code | Label |
|---|---|
| CZK | CZK — Czech koruna |
| EUR | EUR — Euro |
| USD | USD — US dollar |
| GBP | GBP — British pound |
| PLN | PLN — Polish złoty |
| CHF | CHF — Swiss franc |
| SEK | SEK — Swedish krona |
| NOK | NOK — Norwegian krone |
| DKK | DKK — Danish krone |
| HUF | HUF — Hungarian forint |

A current value outside this list is added as "XXX — other".

### 1.8 AI billing tab (AI subscriptions), `ai-tools-tab.tsx`
- Explainer text. A **"View totals in"** currency select (default CZK) and the button **"Add AI billing"**.
- An amber alert "Exchange rate unavailable" lists `fxMissingCurrencies`.
- **4 KPI cards:**
  - Lifetime AI billing (view currency)
  - Overlap this month
  - Active entries
  - Total entries
- **Chart card**, with a toggle between **Monthly** (default) and **Cumulative**:
  - Monthly: a bar chart of `spendByMonth`. The current month bar is `primary`; the others are `primary` at 45 % alpha.
  - Cumulative: a line chart of `cumulativeByMonth` (primary, width 2, no dots).
  - Height is about 200 px. Y is formatted with money.
- **"Most tracked hours credited":** the top 8 `{name, trackedHours}h`.
- **Entries:** active entries (`metrics.isActive`) are shown as cards. "Past entries (N)" is collapsible.
- **Period card:**
  - Left border 3 px: `green-500` running, `amber-500` depleted, `border` ended.
  - Header: the name, a state badge ("Running" / "Depleted" / "Ended"), and a cadence badge (Monthly / Weekly / Quarterly / Yearly).
  - Dates: "start → end" or "open-ended". Then either "Depleted {date}" or "Window closes: {min(now, endsAt, depletedAt)}".
  - Actions:
    - **Mark depleted:** only on active, non-depleted cards; `PATCH {depletedAt: now}`.
    - **Clear depletion:** `PATCH {depletedAt:null}`.
    - Edit (pencil).
    - Delete (trash, with a confirm dialog "Delete this AI billing entry?").
  - Body:
    - Account email and Provider link (hostname without "www.").
    - "Monthly price:" or "One-time price:" money. It adds "(~X CZK)" when the view currency is CZK and differs from the entry's currency.
    - "Overlap hours (N tasks): Xh", "Active days: N", "Paid billable earnings: …" per currency.
    - The note, in italics.
- **Add/Edit dialog:**
  - **Preset** (optional; disabled in edit; choosing one sets the name).
  - **Display name.**
  - **Account email** (optional).
  - **Link to subscription provider** (optional; `https://` is auto-prefixed server-side).
  - **Price:** labelled "Monthly price" for recurring, "Amount paid" for purchase; must be positive.
  - **Currency.**
  - **"How you pay":** One-time subscription (`purchase`) or Recurring subscription (`recurring_monthly`). Changing it resets the cadence and end date.
  - **Cycle:** "Billing cycle" (recurring) or "Paid coverage period" (purchase): Monthly / Weekly / Quarterly / Yearly.
  - **Subscription period:**
    - **Starts on:** a date sent as local start of day in ISO.
    - Purchase: shows "Coverage ends after period: {date}", computed as the local end of day of `coveragePeriodEndYmd(start, cadence)`:
      - weekly = the Sunday of the Monday-based week
      - monthly = month end
      - quarterly = quarter end
      - yearly = Dec 31

      A checkbox "Use a different end date" reveals "Ends on".
    - Recurring: a checkbox "Ended / ends on a date" reveals "Ends on" (unchecked = open-ended, `endsAt:null`).
    - The end must be ≥ start.
  - **Note** (optional).
  - Create only: "Save as new preset for next time" plus a preset name (sent as `saveAsPreset: {name}`).
- Built-in presets are auto-seeded per user on the first presets or periods call:

  | Name | providerKey | sortOrder |
  |---|---|---|
  | Cursor Pro | cursor | 0 |
  | ChatGPT Plus | openai | 1 |
  | GitHub Copilot | github_copilot | 2 |
  | Claude Pro | anthropic | 3 |
  | Perplexity Pro | perplexity | 4 |
  | Midjourney | midjourney | 5 |
  | JetBrains AI | jetbrains | 6 |
  | Other / custom | other | 99 |

- **Not in the web UI** (the API exists): preset rename, delete and create outside of `saveAsPreset`; and `aiTargetHoursPer100Czk` settings.

**Metrics semantics** (server, `ai-subscription-metrics.ts` / `-enrich.ts`):
- `windowEnd = min(now, endsAt?, depletedAt?)`.
- `isActive = (endsAt == null || endsAt > now) && (depletedAt == null || depletedAt > now)`.
- `durationDays = max(1, ceil((windowEnd − startsAt)/86400000))`.
- **Tracked hours allocation:**
  - Every event of the user, including hidden tasks, is split into slices at all window boundaries.
  - Each slice is credited to exactly one period: the period whose window contains the slice midpoint and has the **earliest startsAt**, with ties broken by period id (string compare).
  - `trackedHours` is rounded to 2 dp. `tasksWithTrackedTime` and `eventsInWindow` are distinct counts.
- `paidEarningsByCurrency`:
  - Covers **paid** billing sessions (enrolled tasks) overlapping the window.
  - Each session contributes `earnings × overlapFraction`, rounded to 2 dp per currency.
- `priceApproxCzk`: the price converted to CZK via FX (null if unavailable).
- Analytics:
  - **Lifetime:** purchase = price; recurring = price × inclusive calendar months touched by `[startsAt, windowEnd]` (min 1). The result is converted to the view currency.
  - **Month overlap:** the sum of `price` (× FX) for every period whose `[startsAt, windowEnd]` overlaps the current calendar month, of either kind.
  - **spendByMonth:** purchase puts its price in the start month; recurring puts its price in each month from `startOfMonth(start)` to `startOfMonth(windowEnd)`. `cumulativeByMonth` is the running sum. Months are `yyyy-MM` in **server local time**.
- **FX:** Frankfurter (ECB), `https://api.frankfurter.app/latest?from=X&to=Y,…`, cached in memory for 6 h. It tries the inverse rate as a fallback. Currencies without a rate are excluded from totals and listed in `fxMissingCurrencies`.
- Validation: `depletedAt ≥ startsAt`, and `depletedAt ≤ endsAt` when `endsAt ≥ startsAt`. `endsAt ≥ startsAt`.

### 1.9 Leaderboard / presence / "team" (Home card, `daily-leaderboard.tsx`)
- "Team" = **every user in the database**. There is no team or org model.
- **Header:**
  - Title: "Today's leaderboard" / "This week's leaderboard" / "This month's leaderboard", or "Leaderboard" for a past period.
  - Subtitle:
    - "Live times, updating as people track" if anyone is live now.
    - Otherwise "Who's grinding the most today / this week / this month".
    - For a past period: "How the grind looked that day / week / month".
- **Controls:** ‹ prev, then a pill holding a calendar icon (opens a date picker, days after today disabled, from 2018) and the segmented **Daily | Weekly | Monthly** `[UNCOMMITTED; HEAD is Daily only]`, then › next (disabled in the current period).
  - Prev/next step by 1 day, 7 days, or 1 month.
  - A day key can never exceed today. Weeks start on Monday.
- **Rows:** from `GET /api/presence?timezone&day&range`.
  - Rank "1", "2", "3" in colours amber-600, zinc-500 and amber-800; later ranks are plain.
  - Name, plus " · you" for the current user.
  - Live users get a green pinging dot, the row background `emerald-500/10` with an inset ring `emerald-500/25`, and the subline "Live · {taskName} · {X} this stretch" in emerald-700.
  - Your own (non-live) row: `bg-primary/5`.
  - Right side: the period total `todayMs` plus the **live part** (`liveRangeMs(startTime, now, periodStart, periodEnd)`). It ticks every 1 s while anyone is live.
  - The list only includes users with more than 0 ms in the period, or live now.
  - Empty state: "Nobody logged time that day/week/month."
- **Footer:**
  - "Your today / Your week / Your month" (or "You that day…"). For the current day this uses `/api/stats`.todayTotal plus live; otherwise your leaderboard row plus live.
  - "All time" = `/api/stats`.grandTotal plus the full live stretch.
- **Refresh:** poll every 15 s while the period is current. Also invalidate on socket `presence:changed`, on reconnect, and on window focus.
- `name` = `displayName` if set, otherwise the email local-part with `._-` turned into spaces and each word capitalised (`john.doe@x` becomes "John Doe").

### 1.10 Visualizations `/visualizations` `[UNCOMMITTED]`
Title "Visualizations", subtitle "Play the hours back and watch the team race".
- **Range chips** (the selected one is `bg-zinc-900 text-white`): Past week (default: today−6 → today), This week (Monday → today), This month (1st → today), Last month, Custom (two date popovers; From ≤ To ≤ today). The server caps the span at 93 days.
- **Controls:**
  - Play / Pause / "Play again", and Restart.
  - A clock "m:ss / m:ss".
  - Playback length **30 s | 1 min (default) | 2 min**.
  - A scrubber (0–1000). Scrubbing pauses playback.
  - The **Space** key toggles play.
- **Bar race stage:**
  - Background `#f7f7f5`, `rounded-xl`, border. Kicker "HOURS WORKED" (11 px, tracking 0.2em, zinc-400).
  - Rows are 64 px each, sorted by cumulative ms at the playhead (ties by name). Rows animate their Y position over 0.7 s with easing `cubic-bezier(0.22,1,0.36,1)`.
  - Row contents:
    - The rank (1–3 medal colours as on the leaderboard; others zinc-400).
    - The name (4.75 rem, or 10 rem at sm and up; semibold zinc-800).
    - A track `zinc-200/50`.
    - The bar, in the user's colour, with width `max(3%, ms/max × 78%)`, `rounded-sm`, and a shadow `0 8px 18px -12px color`.
    - At the bar end, a 36 px initials badge in the user colour with a 3 px white border.
    - The duration after it (15–18 px semibold, `formatRaceDuration`: "0m", "Ns" under a minute, "Hh Mm").
  - Bottom-right: the weekday (zinc-400), "d MMM" (36–60 px bold zinc-800), "HH:mm" (zinc-400), and "TRACKIFY".
- Cumulative ms at time T = the sum over the user's **merged** intervals of the overlap with `[rangeStart, T]`.
- The user colour comes from `colorForId(userId)` (§5.3).
- Empty and error states: "Nobody logged time in this range." / "Couldn't load the race. Try another range."

### 1.11 AI chat `/chat` (and the desktop sidebar)
- **Conversation tabs:** a horizontal scroll strip of all conversations (**oldest first**, by `updatedAt` asc), auto-scrolled to the end.
  - Title: the first 3 words plus "..." (or "New chat").
  - A "+" button creates a conversation (`POST /api/conversations`).
  - The active tab is filled with the primary colour.
  - **There is no delete in the UI** (the API exists).
  - Initially no conversation is selected; the first send creates one.
- **Empty state:** Bot icon, "How can I help?", "Try something like:", and 3 example buttons: "What tasks do I have?", "How much did I work this week?", "Log 2 hours to my project yesterday".
- **Messages:**
  - User bubbles: right-aligned, primary colour.
  - Assistant: left-aligned, muted, rendered as GitHub-flavoured Markdown (tables scroll horizontally).
- **Tools:**
  - Read tools run on the server automatically: `listTasks`, `findTask`, `listTaskGroups`, `listEvents`, `getStats`.
  - **Write tools need approval**: `createTask`, `createEvent`, `deleteEvent`, `updateEvent`, `setTaskGroupMembership`.
- **Approval card:**
  - Amber border, amber at 10 % background, AlertCircle icon, the tool label, a human description, and the buttons **Approve** / **Reject**.
  - Approve sends `POST /api/chat/execute-tool {toolName, args, timezone}`, adds the result as the tool output, and re-sends to continue.
  - Reject adds the output `{rejected:true, message:"User rejected this action"}` and continues.
  - **Sending a new message while approvals are pending auto-rejects them** with the output `{rejected:true, message:"User sent a new message instead of approving - they may want to change or correct the request"}`.
- **Tool status lines:**
  - "Executing X..." (blue spinner).
  - "X - Rejected" (red background).
  - Completed: green check, "X (args)", with the error message in red when `success:false`.
- After a write tool succeeds, the client refetches tasks, groups, stats and events.
- **Input:** an auto-growing textarea. Enter sends; Shift+Enter inserts a newline. Send icon, or a Stop square while streaming.
- Tool labels:

  | Tool | Label |
  |---|---|
  | listTasks | "Get all your tasks" |
  | findTask | "Search for a task" |
  | listEvents | "List time entries" |
  | listTaskGroups | "List task groups" |
  | createTask | "Create a new task" |
  | createEvent | "Log time to a task" |
  | getStats | "Get time statistics" |
  | deleteEvent | "Delete a time entry" |
  | updateEvent | "Update a time entry" |
  | setTaskGroupMembership | "Add task to a group or remove from group" |

- Approval descriptions:
  - createEvent: `Log time entry to "{taskName}" from {date} to {date}`
  - createTask: `Create task "{name}"`
  - deleteEvent: "Delete time entry"
  - setTaskGroupMembership: "Assign task to group" / "Remove task from its group"

### 1.12 Settings `/settings`
- **Account card:**
  - Email (read-only).
  - **Display name** form: max 40 characters, trimmed, non-empty; the button is enabled only when dirty. Helper text: "Shown when you are tracking a task." Status text "Saved" or an error.
  - **Sign out** (destructive).
- **Hidden Tasks card:**
  - `GET /api/tasks?hidden=true`, sorted by `updatedAt` desc, each showing the name and total time.
  - **Restore** sends `PUT /api/tasks/:id {hidden:false}`.
  - Empty state: "No hidden tasks".
- The web has no password change, account deletion, token management or theme toggle.

---

## 2. REST API reference

Conventions:
- JSON bodies. Errors are `{ "error": string }`, and on 500s in development mode they also carry `"detail"`.
- zod errors return 400 with the *first* issue message.
- `401 {"error":"Unauthorized"}` when there is no valid session or Bearer token.
- **Auth column:**
  - **B** = uses `getAuthUser` (works with Bearer).
  - **P** = public.
  - **S** = session-only.
- Dates in bodies must satisfy zod `.datetime()`: ISO 8601 with a **`Z` suffix and no offset** (zod v4 default: offsets are rejected), e.g. `2026-09-26T10:00:00.000Z`.
- Prisma dates serialise as ISO strings with `Z`. **Timer endpoints return `startTime` as epoch ms numbers.**

### 2.0 Common JSON shapes
```ts
Event        = { id: string; from: ISO; to: ISO; name: string; taskId: string;
                 paymentRecordId: string|null; paidAmount: number|null }
TaskGroupRef = { id: string; name: string; color: string|null }   // color "#RRGGBB" or null
Task         = { id; name; hidden: boolean; createdAt: ISO; updatedAt: ISO; userId; taskGroupId: string|null;
                 events: Event[]; taskGroup: TaskGroupRef|null }
Group        = { id; name; color: string|null; userId; createdAt; updatedAt; taskIds: string[] }
BillingSessionRow = { id /*eventId*/; from: ISO; to: ISO; name; taskId; taskName;
  taskGroup: {id,name,color?}|null; hourlyRate: number; currency: string;
  rawDurationMinutes: int; durationMinutes: int; earnings: number; isPaid: boolean;
  paymentRecordId: string|null; paymentPaidAt: ISO|null;
  groupDay: "yyyy-MM-dd"; groupWeek: "YYYY-Www"; groupMonth: "yyyy-MM" }  // group keys in UTC
```

### 2.1 Auth
| Method | Path | Auth | Body | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/auth/token` | P | `{email: string(email), password: string(min1)}` | `{token: string(64 hex), expiresAt: ISO(+30d), user:{id,email}}` | 400 zod ("Invalid email address", "Password is required"); 401 "Invalid email or password"; 500 |
| DELETE | `/api/auth/token` | B | – (the header token is revoked) | `{success:true}` | 401; 400 "Bearer token required" if authed via cookie |
| POST | `/api/auth/register` | P | `{email: email, password: min 6}` | `{id, email}` (no token) | 400 "User already exists" / zod; 500 |
| POST | `/api/auth/forgot-password` | P | `{email}` | `{message:"If an account exists, a reset email has been sent"}` (always) | 400 "Email is required"; 500 "Failed to process request" |
| POST | `/api/auth/reset-password` | P | `{token, password(≥6)}` | `{message:"Password reset successfully"}` | 400 "Token and password are required" / "Password must be at least 6 characters" / "Invalid or expired reset link" / "Reset link has expired"; 500 |
| GET/POST | `/api/auth/[...nextauth]` | – | next-auth internals (web only) | | |

Token details:
- `randomBytes(32).hex`, stored in plaintext in `trackify_api_token`.
- Default name "Mobile App". `lastUsedAt` is updated on each use. Expiry is **30 days, fixed**, with no refresh.
- The email is matched **case-sensitively** as typed.

### 2.2 Tasks
| Method | Path | Auth | Query/Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/tasks` | B | `?hidden=true` returns **only** hidden tasks (default: only visible) | `Task[]` sorted by name asc; each task's `events` sorted `from` desc (**all events, unbounded**) | 500 |
| POST | `/api/tasks` | B | `{name: string 1..100}` | 201 `Task` (`events: []`) | 400 |
| GET | `/api/tasks/:id` | B | – | `Task` (hidden or not) | 404 "Task not found" |
| PUT | `/api/tasks/:id` | B | `{name?: 1..100, hidden?: boolean}` | `Task` (events unordered) | 400, 404 |
| DELETE | `/api/tasks/:id` | B | – | `{success:true, taskHidden:true}` | 404 |

DELETE is a soft hide (`hidden=true`), and it deletes the user's ActiveTimer row if it belongs to this task. It does **not** update the socket server's in-memory timer and does **not** emit anything; see G8. PUT `hidden:true` does not stop a timer.

### 2.3 Events (time entries)
| Method | Path | Auth | Query/Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/events` | B | `?taskId=` optional | `(Event & {task:{name}})[]` sorted `from` desc; includes hidden tasks' events | |
| POST | `/api/events` | B | `{taskId: uuid, name?: string="Time entry", from: ISO, to: ISO, source?: "timer"\|"manual"}` | 201 `Event & {task:{name}}`, **or** 201 `{skipped:true, reason:"too short"}` | 400 "End time must be after start time"/zod; 404 "Task not found"; 409 overlap message |
| PUT | `/api/events/:id` | B | `{name?: string, from?: ISO, to?: ISO}` | `Event & {task:{name}}` | 400, 404 "Event not found", 409 |
| DELETE | `/api/events/:id` | B | – | `{success:true}` | 404 |

`POST /api/events` semantics:
1. `to` is clamped to now.
2. If `to − from < 60 000 ms`: if `source !== "manual"` and the user's ActiveTimer is on this task, the timer is stopped and `timer:stopped {taskId, duration:0}` is emitted. The call returns `{skipped:true}` and **nothing is saved**.
3. `validateNoOverlap`:
   - It first **deletes unpaid "crumb" events under 60 s** that overlap `[from, to]`.
   - It then checks the remaining events.
   - The **running timer counts as busy only for `source:"manual"`**; timer-sourced writes skip it.
4. The event is created.
5. If `source !== "manual"` and the ActiveTimer is on this task, the timer is stopped and `timer:stopped {taskId, duration}` is emitted to the user.

PUT semantics:
- The overlap check excludes the event itself and includes the running timer (and also absorbs crumbs).
- The clamp-to-now applies only to the check: **the unclamped `to` is stored** (bug).
- Paid events can be edited or deleted freely. Payment totals are not recomputed.

**Overlap 409 message format:** `This time entry overlaps with "{taskName}: {eventName}" ({from.toLocaleString()} - {to.toLocaleString()}, {N}min)`. For the running timer, eventName is "Currently running timer". The dates are formatted in the server locale and timezone.

### 2.4 Timer
| Method | Path | Auth | Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/timer` | B | – | `{running:false}` or `{running:true, taskId, startTime: epochMs}` (a timer on a hidden task counts as not running) | |
| POST | `/api/timer` | B | `{taskId: uuid, startTime?: ISO}` | `{running:true, taskId, startTime: epochMs}`; emits `timer:started` to the user room and `presence:changed` to all | 400 zod / "Start time is too old" (older than now−40 h); 404 "Task not found" (missing, not yours, or hidden); 500 |
| PATCH | `/api/timer` | B | `{taskId: uuid, newStartTime: ISO}` | `{running:true, taskId, startTime: epochMs}`; emits `timer:start-updated` | 400 "Start time cannot be in the future" / "Start time is too old" / "No active timer found to adjust" / "Timer has changed. Please try again."; 409 overlap |
| DELETE | `/api/timer` | B | `?taskId=` optional (only stops if the current timer is on that task) | `{running: boolean}` (true = something else is still running); emits `timer:stopped {taskId, duration}` if it stopped | 500 |
| POST | `/api/timer/validate-start` | B | `{newStartTime: ISO}` | `{valid:true}` | 400 "Start time cannot be in the future"/"Invalid duration"; 409 overlap |

Notes:
- POST is an **upsert**: starting while another task runs just replaces it. **No event is created for the replaced stretch.**
- A POST `startTime` more than 5 s in the future is replaced with now.
- PATCH checks overlap over `[newStart, now]`, ignoring the running timer.
- `validate-start` has a **side effect**: its overlap check deletes overlapping unpaid events under 60 s.

### 2.5 Stats / profile
| Method | Path | Auth | Query/Body | Response |
|---|---|---|---|---|
| GET | `/api/stats` | B | `?timezone=IANA` (default UTC) | `{tasks:[{taskId, taskName, totalTime: ms, todayTime: ms}], grandTotal: ms, todayTotal: ms}` over visible tasks, excluding the live timer |
| GET | `/api/profile` | B | – | `{email, displayName: string}` ("" if unset; **no id**) |
| PATCH | `/api/profile` | B | `{displayName: string trim 1..40}` | `{email, displayName}`; 400 zod; 500 "Failed to update name" |

### 2.6 Presence / leaderboard / visualizations
| Method | Path | Auth | Query | Response |
|---|---|---|---|---|
| GET | `/api/presence` | B | `timezone` (default UTC), `day=yyyy-MM-dd` (clamped to ≤ today in tz; invalid means today), `range=day\|week\|month` `[UNCOMMITTED; HEAD ignores it]` | `{tracking: PresenceEntry[], leaderboard: LeaderboardEntry[], day, range [UNCOMMITTED], isToday, isCurrent [UNCOMMITTED]}` |
| GET | `/api/visualizations/race` `[UNCOMMITTED]` | B | `timezone`, `from`, `to` (yyyy-MM-dd; defaults today−6..today; swapped if reversed; `to` ≤ today; span ≤ 93 days) | `{from, to, rangeStart: ms, rangeEnd: ms(min(end, now)), users:[{id, name, color}], events:[{userId, from: ms, to: ms}]}` |

- `PresenceEntry = {userId, name, taskName, startTime: ms, todayMs}`. `tracking` lists live timers on visible tasks, **only when the period is current**, oldest start first.
- `LeaderboardEntry = {userId, name, todayMs, startTime: ms|null, taskName: string|null}`:
  - `todayMs` = completed events' overlap with the period, across all users.
  - Rows with 0 ms that are not live are omitted.
  - Sort: `todayMs + live` desc, then name. Live = `now − start` for day ranges; for week or month it is the overlap with the window.
  - Note that presence period totals include events of hidden tasks. The race excludes them.
- Race events are clipped to the range, merged per user (overlaps unioned), and include live timers if now lies within the range.

### 2.7 Groups
| Method | Path | Auth | Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/groups` | B | – | `Group[]` by createdAt asc | |
| POST | `/api/groups` | B | `{name: 1..100, taskIds: string[], color?: "#RRGGBB"\|null}` | 201 `Group` | 400 "One or more tasks were not found"/"Color must be a #RRGGBB hex value"; 409 "One or more tasks already belong to a group. Each task can only be in one group." |
| PUT | `/api/groups/:id` | B | `{name?, taskIds?: string[] (full replacement), color?: hex\|null}` | `Group` | 404 "Not found"; 400; 409 "...already belong to another group..." |
| DELETE | `/api/groups/:id` | B | – | `{success:true}` (member tasks become ungrouped) | 404 |

### 2.8 Billing
| Method | Path | Auth | Query/Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/billing/tasks` | B | – | `[{id, taskId, userId, hourlyRate, currency, roundingMins, createdAt, updatedAt, task:{id,name,hidden,taskGroup:{id,name,color}\|null}}]` by updatedAt desc | |
| POST | `/api/billing/tasks` | B | `{taskId: uuid, hourlyRate: number≥0, currency?: string 1..12 = "CZK", roundingMins?: 0\|15\|30\|60 = 0}` | 201 same row shape | 404 "Task not found"; 409 "Task is already enrolled in billing"; 400 |
| PATCH | `/api/billing/tasks/:id` (billingTask id) | B | `{hourlyRate?, currency?, roundingMins?}` (non-empty) | row | 400 "No fields to update"; 404 |
| DELETE | `/api/billing/tasks/:id` | B | – | `{ok:true}` | 404 |
| GET | `/api/billing/sessions` | B | `from`, `to` (ISO; filter on event.from gte/lte), `taskId` (must be enrolled), `taskGroupId` (uuid \| `ungrouped`), `status=unpaid\|paid\|all` (default all), `groupBy=day\|week\|month` (echoed only) | `{sessions: BillingSessionRow[] (from desc), groupBy}` | 400 "Invalid taskGroupId"/"Task is not enrolled in billing"/"Invalid from date"/"Invalid to date" |
| GET | `/api/billing/summary` | B | – | `{byCurrency: {[CUR]: {unpaidTotal, thisWeekTotal, thisMonthTotal, allTimeTotal, allTimePaidTotal}}}` (week and month = **UTC** ISO week / month of event.from, 2 dp) | |
| GET | `/api/billing/payments` | B | – | `[{id, paidAt, note, totalAmount, totalMinutes, currency, createdAt, sessions: BillingSessionRow[]}]` paidAt desc | |
| POST | `/api/billing/payments` | B | `{eventIds: uuid[] ≥1, paidAt: ISO, note?: ≤2000, lineAmounts?: {[eventId uuid]: number≥0}}` | `{id, paidAt, note, totalAmount, totalMinutes, currency, eventCount, createdAt}` | 400: "lineAmounts must include exactly one amount per selected session", "lineAmounts must include every selected session", "lineAmounts contains an unknown event id", "Duplicate event ids in request", "Some events were not found, are already paid, or are duplicated", "Some events belong to tasks not enrolled in billing", "All sessions in one payment must use the same currency" |
| GET | `/api/billing/payments/:id` | B | – | same as a list item | 404 |
| DELETE | `/api/billing/payments/:id` | B | – | `{ok:true}` (reopen: events become unpaid and `paidAmount` is set to null) | 404 |

**Billing math** (`lib/billing.ts`):
- `durationMinutes = floor((to−from)/60000)`.
- `earnings = round2(minutes/60 × hourlyRate)`. **`roundingMins` is ignored** (kept for compatibility; the UI always sends 0).
- For a paid event with `paidAmount != null`, earnings = `round2(paidAmount)`, the amount recorded at payment.
- Payment `totalAmount` = the sum of line amounts (default: computed earnings), rounded to 2 dp. `totalMinutes` = the sum of `durationMinutes`. The currency is the billing currency of the tasks.
- Payment sessions whose task is no longer enrolled are omitted from `sessions`.
- The `POST /payments` event lookup does not check event ownership directly; it relies on the enrolled-task check.

### 2.9 AI subscriptions
| Method | Path | Auth | Query/Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/ai-subscriptions/presets` | B | – (seeds built-ins) | `[{id, userId, name, providerKey, isBuiltIn, sortOrder, createdAt}]` by sortOrder, name | |
| POST | `/api/ai-subscriptions/presets` | B | `{name: 1..120, providerKey?: ≤64\|null, sortOrder?: int}` | 201 preset | 400 |
| PATCH | `/api/ai-subscriptions/presets/:id` | B | `{name?, providerKey?, sortOrder?}` | preset | 403 "Built-in presets cannot be edited"; 404 |
| DELETE | `/api/ai-subscriptions/presets/:id` | B | – | `{ok:true}` (periods keep `presetId:null`) | 403 "Built-in presets cannot be deleted"; 404 |
| GET | `/api/ai-subscriptions/periods` | B | – | `{periods: EnrichedPeriod[]}` startsAt desc | 503 with a Prisma P2022 hint |
| POST | `/api/ai-subscriptions/periods` | B | see below | 201 `{period: EnrichedPeriod}` | 400 "Invalid startsAt" / "endsAt must be on or after startsAt" / depletion errors; 404 "Preset not found" |
| PATCH | `/api/ai-subscriptions/periods/:id` | B | same fields, all optional; `null` clears nullable ones | `{period}` | 400, 404 |
| DELETE | `/api/ai-subscriptions/periods/:id` | B | – | `{ok:true}` | 404 |
| GET | `/api/ai-subscriptions/analytics` | B | `viewCurrency` (3 letters, default CZK), optional `from` & `to` (ISO; filter `periods` and `rankings` only) | see below | |
| GET/PATCH | `/api/ai-subscriptions/settings` | B | PATCH `{aiTargetHoursPer100Czk?: number>0\|null}` | `{aiTargetHoursPer100Czk: number\|null}` | 400 |

Period create body:
```ts
{ name: string 1..200, price: number>0, currency?: string 1..12 = "CZK" (stored upper-cased),
  startsAt: ISO, endsAt?: ISO|null, depletedAt?: ISO|null,
  billingKind?: "purchase"|"recurring_monthly" = "purchase",
  billingCadence?: "monthly"|"weekly"|"quarterly"|"yearly" = "monthly",
  presetId?: uuid|null, note?: ≤2000|null,
  billingEmail?: email ≤320|""|null   // "" → null
  billingProviderUrl?: url ≤2048|""|null   // "https://" auto-prefixed if missing; "" → null
  saveAsPreset?: { name: 1..120, providerKey?: ≤64|null } }   // creates a preset and links it
```

Enriched period shape:
```ts
EnrichedPeriod = { id, userId, presetId, name, price, currency, startsAt: ISO, endsAt: ISO|null, depletedAt: ISO|null,
  billingKind: "purchase"|"recurring_monthly", billingCadence, billingEmail, billingProviderUrl, note,
  createdAt, updatedAt, priceApproxCzk: number|null,
  metrics: { tasksWithTrackedTime: int, trackedHours: number(2dp), eventsInWindow: int, durationDays: int, isActive: boolean },
  paidEarningsByCurrency: { [CUR]: number } }
```

Analytics response:
```ts
{ viewCurrency, fxMissingCurrencies: string[],
  summary: { lifetimeSpendInView, currentMonthOverlapSpendInView, activeSubscriptions, periodCount },
  cumulativeByMonth: [{month:"yyyy-MM", totalInView}], spendByMonth: [{month, totalInView}],
  rankings: { mostTrackedHours: [{id, name, trackedHours}] /* top 8 */ },
  periods: EnrichedPeriod[] }
```

### 2.10 Conversations / chat
| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/conversations` | B | – | `[{id, title: string\|null, updatedAt, createdAt}]` by **updatedAt asc** |
| POST | `/api/conversations` | B | – | `{id, title:null, createdAt, updatedAt}` |
| DELETE | `/api/conversations/:id` | B | – | `{success:true}`; 404 `{error:"Not found"}` |
| GET | `/api/conversations/:id/messages` | B | – | `[{id, conversationId, role:"user"\|"assistant", content: string, parts: UIPart[]\|null, createdAt}]` asc |
| POST | `/api/chat` | B | AI SDK UIMessage chat request (below) | **SSE UI-message stream** (AI SDK v6 `toUIMessageStreamResponse`) |
| POST | `/api/chat/execute-tool` | B | `{toolName, args, timezone?}` | tool result JSON |
| GET | `/api/chat/model` | P | – | `{model:"claude-sonnet-5", gitSha, gitShaShort, builtAt}` |

**`POST /api/chat` request:**
```jsonc
{ "id": "<client chat id>", "messages": [UIMessage...], "trigger": "submit-message",
  "conversationId": "<uuid>|null", "timezone": "Europe/Prague" }
UIMessage = { id, role: "user"|"assistant", parts: [ {type:"text", text} |
             {type:"tool-<name>", toolCallId, state:"input-available"|"output-available", input:{...}, output?:any} ] }
```

Server behaviour:
- If the **last** message is a user message with text, it is saved.
- The conversation title is set to the first 30 characters of the first user message.
- The model runs with up to 10 steps.
- On finish, **one new assistant row** is saved with its parts: `{type:"text"}` and `{type:"tool-X", toolCallId, state:"result", input:{} /*see G14*/, output}`.
- Errors are plain text (not JSON): 401 "Unauthorized", 404 "Conversation not found". When `conversationId` is null, nothing is persisted.

Response: the SSE stream `data: {json}\n\n` with the header `x-vercel-ai-ui-message-stream: v1`. Chunk types include:
- `start`, `start-step`
- `text-start` / `text-delta{delta}` / `text-end`
- `tool-input-start{toolCallId, toolName}` / `tool-input-delta` / `tool-input-available{toolCallId, toolName, input}`
- `tool-output-available{toolCallId, output}`
- `finish-step`, `finish`
- a final `data: [DONE]`

**Approval loop (client-driven):**
- Write tools have no server `execute`, so the stream stops with the part in state `input-available`.
- The client shows Approve / Reject:
  - **Approve:** `POST /api/chat/execute-tool {toolName, args: input, timezone}`.
  - **Reject:** `{rejected:true, message:"User rejected this action"}`.
- The client then sets that part to `state:"output-available", output: <result>` and POSTs `/api/chat` again with the **full** message list (`trigger:"submit-message"`) so the model continues.

**Tools (server `createTools(userId, timezone)`):**
- `listTasks {}` returns `[{id, name, groupId, groupName, groupColor, totalTime:"Xh Ym", lastActivity:"Mon D"}]`.
- `findTask {query}` returns `{found:true, tasks:[{id,name,groupId,groupName,groupColor}]}` or `{found:false, message, availableTasks}`.
- `listTaskGroups {}`.
- `listEvents {taskId?, taskName?, limit?=10 (max 50), startDate?, endDate?, orderBy?:"newest"|"oldest"}`.
- `getStats {period?: today|week|month|year|all, startDate?, endDate?}`.
- Approval tools:
  - `createTask {name}`
  - `createEvent {taskId, taskName, from, to, name?}`
  - `deleteEvent {eventId}`
  - `updateEvent {eventId, newFrom?, newTo?}`
  - `setTaskGroupMembership {taskId, groupId?: string|null}`

**`execute-tool` results:**
- Success: `{success:true, message, ...}`. Failure: `{success:false, error}`.
- `createEvent` / `updateEvent` parse times **without an offset** in the user timezone. They reject events that end in the future and check overlaps (including the running timer).
- `setTaskGroupMembership` refuses to move a task that is already in another group.
- 400 `{error:"Unknown tool"}`; 500 `{error:"Tool execution failed"}`.

---

## 3. Socket.IO

### 3.1 Connection
- URL: the same origin as the API. Path `/socket.io` (the default). Socket.IO **v4 protocol** (EIO=4). CORS `origin: true, credentials: true`. Server `pingInterval 25000`, `pingTimeout 60000`.
- The web client (`lib/socket.ts`) uses:
  - `transports: ["websocket","polling"]`
  - reconnection with infinite attempts, delay 400 ms, max 5 s, randomisation 0.5
  - timeout 20 s
  - `autoConnect:false`
- Compatible native libraries: Socket.IO-Client-Swift 16.x (v4) and `io.socket:socket.io-client` 2.x (v4).
- **There is no handshake auth** (`auth:{}` and cookies are ignored). Authentication is an application-level event emitted after connecting.

### 3.2 `authenticate` (quoted from `server/index.ts`)
```ts
socket.on("authenticate", async (data: { userId?: string; token?: string }) => {
  if (userId) socket.leave(`user:${userId}`);
  if (data.token) {
    const apiToken = await prisma.apiToken.findUnique({ where: { token: data.token }, include: { user: { select: { id: true } } } });
    if (!apiToken || apiToken.expiresAt < new Date()) {
      socket.emit("auth:error", { message: "Invalid or expired token" }); socket.disconnect(); return;
    }
    userId = apiToken.user.id; socket.join(`user:${userId}`);
    socket.emit("auth:success", { userId });
    prisma.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return;
  }
  // Web app: trust userId from authenticated session
  if (data.userId) { userId = data.userId; socket.join(`user:${userId}`); return; }   // no auth:success, NOT verified
  socket.emit("auth:error", { message: "No authentication provided" }); socket.disconnect();
});
```

So: **Bearer tokens are supported over the socket** (`emit("authenticate", {token})`), and `auth:success {userId}` is emitted only on the token path. The web path is `{userId}` with **no verification** (security hole G1).
- On exception the server emits `auth:error {message:"Authentication failed"}` and disconnects.
- Every handler ignores events until `authenticate` has succeeded (`if (!userId) return`).
- Re-authenticate after **every reconnect**, because the room is lost. The web client re-emits `authenticate` on each `connect`, and on focus, visibility, online and pageshow events.

### 3.3 Rooms
- One room per user: `user:{userId}`. All of a user's devices get the same broadcasts, **including the sender**.
- `presence:changed` is broadcast to **all connected sockets** (even unauthenticated ones), with no payload.

### 3.4 Client → Server events
| Event | Payload | Server action |
|---|---|---|
| `authenticate` | `{token}` (native) / `{userId}` (web) | see above |
| `timer:request-state` | – | If a timer is in memory for the user, emits `timer:state {taskId, startTime, running:true}` **to this socket only**. **Silent if idle** (use `GET /api/timer` to learn "idle"). |
| `timer:start` | `{taskId, startTime?: epochMs}` | `startTime` more than 5 s in the future becomes now. `persistTimerStart` upserts the ActiveTimer (task must be yours and not hidden). Emits `timer:started {taskId, startTime}` to the room and `presence:changed` to all. On failure it emits `timer:error {action:"start", message:"Task not found"\|"Failed to start timer. Please try again."}` to the sender. No 40 h check here. |
| `timer:stop` | `{taskId, duration: ms}` | `persistTimerStop(userId, taskId)` stops only if the current timer is on `taskId`. If it stopped, it emits `timer:stopped {taskId, duration}` (the duration is echoed from the client). On a DB error it clears memory and emits stopped anyway. **No event is saved.** |
| `timer:update-start` | `{taskId, newStartTime: epochMs}` | Validates in memory: a timer exists, the task matches, and the time is not in the future. It checks for **any** event overlapping `[newStart, now]`, with no crumb absorption. It then persists and emits `timer:start-updated {taskId, startTime}` to the room and `presence:changed` to all. Errors go to `timer:error {action:"update-start", message}` with the messages "No active timer found to adjust", "Timer has changed. Please try again.", "Start time cannot be in the future", `This would overlap with "{task}: {event}"`, and "Failed to update start time. Please try again." |
| `task:created` | Task JSON | Relayed verbatim to the room. |
| `task:updated` | Task JSON | Relayed verbatim to the room. |
| `task:deleted` | `taskId` (string) | If the memory timer is on that task, it is stopped via `persistTimerStop`, **without emitting timer:stopped**. The id is relayed to the room. |
| `event:created` | any | Relayed to the room. (The web never emits it.) |
| `task:hidden` | taskId | The web emits it but **there is no server handler**. |

### 3.5 Server → Client events
| Event | Payload | Sources |
|---|---|---|
| `auth:success` | `{userId}` | token auth only |
| `auth:error` | `{message}` | auth failure, then a disconnect |
| `timer:state` | `{taskId, startTime: ms, running: true}` | reply to request-state |
| `timer:started` | `{taskId, startTime: ms}` | socket `timer:start`, `POST /api/timer` |
| `timer:stopped` | `{taskId, duration: ms}` | socket `timer:stop`, `DELETE /api/timer`, and `POST /api/events` when it stops the matching timer (duration 0 for too-short) |
| `timer:start-updated` | `{taskId, startTime: ms}` | socket `timer:update-start`, `PATCH /api/timer` |
| `timer:error` | `{action: "start"\|"update-start", message}` | socket only, to the sender |
| `task:created` / `task:updated` | Task JSON | client relays only (the REST handlers **do not** emit) |
| `task:deleted` | taskId | client relay |
| `event:created` | any | client relay |
| `presence:changed` | none | any timer start / stop / start-time change (REST or socket); refetch `/api/presence` |

### 3.6 Presence semantics
- "Live" = the user has an `ActiveTimer` row on a non-hidden task. That row is authoritative in the DB; the in-memory map is loaded on boot, and timers on hidden tasks are purged at boot.
- The **socket connection itself does not imply presence.** A disconnected device's timer keeps running server-side indefinitely.
- There is no per-user online indicator. Presence data comes only from `GET /api/presence`; the socket merely signals that something changed.

---

## 4. Timer semantics (detailed)

### 4.1 Data model
- `ActiveTimer {id, userId UNIQUE, taskId, startTime, createdAt}` holds at most one running timer per user.
- In memory (`globalThis.__trackifyTimers`): `Map<userId, {taskId, startTime(ms), socketIds}>`. It is shared between the socket server and the Next API routes (same process) via `timer-runtime.ts`.
- `Event {from, to, name="Time entry", taskId, paymentRecordId?, paidAmount?}`. A saved stretch is an Event. Events never overlap per user.

### 4.2 Server primitives (`lib/timer-runtime.ts`)
- `persistTimerStart(userId, taskId, startMs)`:
  - The task must belong to the user and not be hidden (otherwise throws "Task not found").
  - It **upserts** the ActiveTimer, so starting replaces any running timer.
  - It sets memory and emits `presence:changed`.
- `persistTimerStop(userId, taskId?)`:
  - If `taskId` is given and the current timer (memory, else DB) is on a different task, it returns false and **does nothing**.
  - Otherwise it deletes the DB row and the memory entry, emits `presence:changed`, and returns true.
- `persistTimerStartTime(userId, taskId, newStart)`: requires the current timer to be on `taskId`. It updates the DB and memory and emits `presence:changed`.

### 4.3 Limits and constants
| Rule | Value / where |
|---|---|
| Minimum saved stretch | `MIN_EVENT_MS = 60_000` (`lib/event-limits.ts`); applies on the client (drop) and the server (`skipped`) |
| Crumbs | unpaid events under 60 s overlapping a new write range are **deleted** before the overlap check (`absorbTinyUnpaidEvents`). This runs in `POST /api/events`, `PUT /api/events/:id`, `PATCH /api/timer`, `POST /api/timer/validate-start` and AI `execute-tool`. Not in socket `timer:update-start`. |
| Start / adjust lookback | 40 h: `POST /api/timer` & `PATCH /api/timer` reject older starts; UI `MAX_LOOKBACK` |
| Future start tolerance | a start more than 5 s in the future becomes now (POST, socket start); PATCH or validate with a future time gives 400 |
| Event `to` in the future | clamped to now (POST events) |
| UI granularity | slider and log-past values snapped to whole minutes |

### 4.4 Web client algorithm (`hooks/use-timer.tsx` + `timer-draft.ts` + `timer-durability.ts` + `timer-sync.ts`)
It is an **optimistic local-first durable queue**, stored in localStorage and sessionStorage under the key `trackify.timer-draft.v2` (migrated from v1):
```ts
TimerQueue = { version: 2, userId?, updatedAt, stopping: StopItem[], running: RunItem|null }
StopItem   = { id:"stop-<ts>-<rand>", kind:"stopping", taskId, startTime, endTime, name:"Time entry" }
RunItem    = { kind:"running", taskId, startTime, synced: boolean, updatedAt }
```
The newest of memory, localStorage, sessionStorage and legacy is chosen by `updatedAt`. It is scoped to `userId`.

**Start(taskId):**
1. If running (A): emit `timer:stop {taskId:A, duration}` and `DELETE /api/timer?taskId=A` (keepalive).
2. `enqueueStart`:
   - If a run exists: `enqueueStop(A, a0, now)`. **If `now − a0 < 60 s`, no stop item is created** (the run is simply dropped).
   - Set `running = {taskId, startTime: now, synced:false}`.
3. The UI shows running with `pendingConfirmation = true` (a pulse). Emit `timer:start {taskId, startTime}`.
4. `kickTimerDurability()`.

**Stop:** `enqueueStop(current, start, now)` (dropped if under 60 s). The UI goes idle with `pendingConfirmation` set. Emit `timer:stop {taskId, duration}`, call `DELETE /api/timer?taskId`, then kick.

**Durability loop** (`runSync`, one at a time, exponential backoff from 600 ms × 1.6 up to 8 s):
1. Take the first `stopping` item:
   - `POST /api/events {taskId, name, from, to}` (no `source`, so it counts as a timer write).
   - `ok` means success. A `409` also counts as success if `GET /api/events?taskId` already has an event with from and to within ±2 s (idempotency).
   - Then `DELETE /api/timer?taskId`, remove the item, and dispatch the `ok/stopping` UI event (which refetches tasks, stats, events and presence).
   - `rejected` (4xx other than 401, 403, 408, 429) stops the loop and shows "Failed to save" with the server message. **The item stays queued**; it is retried on the next kick.
2. Else, if `running && !synced`: `POST /api/timer {taskId, startTime ISO}`.
   - ok: mark synced.
   - rejected: clear running, the UI goes idle, and an error is shown.
3. Classification: 408, 429, 5xx, 401 and 403 are **retry**; other non-OK codes are **rejected**. A network error is retry. For DELETE, a rejected result counts as ok.
- Triggers: `online`, `visibilitychange`→visible, `pageshow`, socket (re)connect, and after every action.
- On hide, `pagehide` or `beforeunload`, it fires all pending POSTs without waiting (`keepalive: true`).

**Hydration on load:**
1. Apply the local running item (pending if unsynced).
2. `GET /api/timer`.
3. If local work is pending, keep the local state and kick.
4. Else, if the server is running, adopt it (synced).
5. Else, if the server is idle and the local run was *synced*, clear it (someone stopped it elsewhere).

**Incoming socket events are ignored while local pending work exists** (`hasPendingWork`):
- `timer:started`: adopt it (and clear pending if the same task).
- `timer:stopped`: ignore it if it is about a different task than the local one. Otherwise clear and go idle, and refetch.
- `timer:state`: adopt if running.
- `timer:start-updated`: if it is the same task, update the start and mark synced.
- `timer:error` (update-start): revert the optimistic start and show the message.

**Adjust start (running):**
1. `POST /api/timer/validate-start` (409 is shown in the dialog).
2. Update the local start.
3. `PATCH /api/timer {taskId, newStartTime}`.
4. Mark synced, **and also** emit socket `timer:update-start` (redundant: it persists twice and broadcasts twice).

**Stop in the past (adjust with an end):**
- `stopAt = min(end, now)`, and it must be greater than the start.
- `enqueueStop(taskId, start', stopAt)` (the start may have been moved too; no separate validation); emit `timer:stop`, `DELETE /api/timer?taskId`, then kick.
- The overlap check happens in `POST /api/events` (a timer write, which ignores the running timer).

### 4.5 Recommended native flow (same server, safest)
- **Start / switch:**
  1. If A is running and `now − a0 ≥ 60 s`, persist A's stretch first: `POST /api/events {taskId:A, from:a0, to:now}` (a timer write, which also stops A server-side if A is still active).
  2. `POST /api/timer {taskId:B, startTime:now}`.
  3. Keep a durable local queue (SQLite, file or DataStore) that is replayed on launch, reconnect or foreground. The server will **not** save the stretch if the app dies.
- **Stop:** `POST /api/events` (if ≥ 60 s), then `DELETE /api/timer?taskId=A`. If the stretch is under 60 s, just call `DELETE /api/timer?taskId=A`.
- **Adjust start:** `PATCH /api/timer` (already validates overlap and 40 h). There is no need for validate-start or the socket.
- **Sync:** socket `authenticate {token}`, then `timer:request-state`, plus `GET /api/timer` for the idle state. React to `timer:started`, `timer:stopped` and `timer:start-updated`. After `timer:stopped` or `presence:changed`, refetch tasks and stats (and presence).
- Treat 409 on replay as possibly already saved: check `GET /api/events?taskId` for a match within ±2 s, as the web does.
- For live UIs (Live Activity, menu bar, notification), compute elapsed as `now − startTime` locally. The server sends no ticks.

---

## 5. Visual design language

### 5.1 Tokens (`globals.css`; shadcn "new-york", base colour neutral; `--radius: 0.5rem`)
| Token | Light (HSL → hex) | Dark (defined, **never activated** in the UI) |
|---|---|---|
| background | 0 0% 100% → `#FFFFFF` | 0 0% 3.9% → `#0A0A0A` |
| foreground | 0 0% 3.9% → `#0A0A0A` | 0 0% 98% → `#FAFAFA` |
| card / popover | `#FFFFFF` / fg `#0A0A0A` | `#0A0A0A` / `#FAFAFA` |
| primary | 0 0% 9% → `#171717` | `#FAFAFA` |
| primary-foreground | `#FAFAFA` | `#171717` |
| secondary / muted / accent | 0 0% 96.1% → `#F5F5F5` | 0 0% 14.9% → `#262626` |
| secondary-fg / accent-fg | `#171717` | `#FAFAFA` |
| muted-foreground | 0 0% 45.1% → `#737373` | 0 0% 63.9% → `#A3A3A3` |
| destructive | 0 84.2% 60.2% → `#EF4444` | 0 62.8% 30.6% → `#7F1D1D` |
| destructive-fg | `#FAFAFA` | `#FAFAFA` |
| border / input | 0 0% 89.8% → `#E5E5E5` | `#262626` |
| ring | `#0A0A0A` | 0 0% 83.1% → `#D4D4D4` |
| chart-1..5 | `12 76% 61%`, `173 58% 39%`, `197 37% 24%`, `43 74% 66%`, `27 87% 67%` (unused by the app's charts) | `220 70% 50%`, `160 60% 45%`, `30 80% 55%`, `280 65% 60%`, `340 75% 55%` |

- Radii: `lg` = 8 px, `md` = 6 px, `sm` = 4 px. Cards use `rounded-xl` (12 px). Pills and bars are fully rounded.
- Browser theme colour: `#fafafa` (light) and `#09090b` (dark).
- In short, this is a monochrome neutral UI: a black primary on white. Colour comes only from task, group and user accents, the heatmap greens, and status colours: green-500 connected, amber-400 reconnecting, red-500 disconnected, emerald for live, and a yellow-500 ring for pending.

### 5.2 Typography and components
- **Fonts:** **Geist Sans** (variable, 100–900) for the UI and **Geist Mono** (variable) for timers and times. Both are local `.woff` files in `src/app/fonts/`, and both are free (SIL OFL) from Vercel. The Tailwind default font stack is used: the CSS variables `--font-geist-sans/mono` are defined, but `body` does not set `font-family` to them, so **text actually renders in the system UI font**, with the `font-mono` family (ui-monospace/SFMono) for clocks. Native apps can use SF Pro / SF Mono and Roboto / Roboto Mono and stay faithful. Numbers use `tabular-nums` throughout.
- **Type scale:**
  - Page title `text-xl` (20 px) or `sm:text-2xl` (24 px), bold, tracking-tight. Subtitle 14–16 px muted.
  - Card title semibold 16 px (`text-base`) or 14 px (`text-sm font-medium`).
  - Body 14 px. Captions 12 px (`text-xs`), 11 px (uppercase labels, `tracking-wide`), and 10 px (pills).
  - Running clock: mono bold 36 px. Dialog durations: mono semibold 36 px.
- **Button:**
  - Height 36 (default), 32 (`sm`, text 12 px), 40 (`lg`), or 36 × 36 (`icon`). Radius 6. Font 14 medium. Icons 16 px. Disabled at 50 % opacity.
  - Variants:
    - default: primary background with primary-fg text and a shadow
    - destructive: red
    - outline: 1 px input border on the background, with `shadow-sm`
    - secondary: `#F5F5F5`
    - ghost: transparent, with an accent hover
    - link
- **Card:** `rounded-xl`, 1 px border, card background, `shadow` (the Tailwind default `0 1px 3px rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1)`). Padding 24 (header and content), with content `pt-0`.
- **Input:** height 36, radius 6, 1 px input border, `shadow-sm`, 14 px text (16 on mobile). Focus: border `foreground/25` with a 3 px glow `ring @ 7%`.
- **Badge:** radius 6, padding 2.5 / 0.5, 12 px semibold. Variants: default (primary), secondary (`#F5F5F5`), outline (border only), destructive.
- **Skeleton:** `primary/10`, pulsing.
- **Dialog:** centred, max-width 512 px by default (up to 672 for billing and AI dialogs), radius about 8–12. Close X top-right.
- **Billing surfaces:**
  - `row`: `rounded-lg`, **2 px** border, card background, `shadow-sm`.
  - `section`: `rounded-xl` with a 2 px border; its header is `bg-muted/55` with a 2 px bottom border.
  - `toolbar`: a 2 px border and `shadow-md`, with a blurred card background.
  - `inset`: a 1 px border, `bg-muted/35`, an inner shadow, padding 12.
- **Animations:**
  - `pending-pulse`: opacity 1 → 0.4 → 1 over 1.5 s ease-in-out, infinite.
  - `pulse-dot`: scale 1 → 1.1 with opacity 1 → 0.7 over 2 s.
  - Billing tab slide: 500 ms `cubic-bezier(0.22,1,0.36,1)`.
- **Icons:** lucide (Play, Square, Plus, BarChart2, Clapperboard, DollarSign, Settings, Home, MessageSquare, EyeOff, RotateCcw, Copy, Pencil, Trash2, ChevronLeft/Right/Up/Down, Calendar, Clock, CircleDollarSign, Receipt, BookOpen, Bot, Send, Check, X, AlertCircle, HelpCircle, ExternalLink, PanelRightOpen/Close, LogOut, Mail, User). SF Symbols and Material equivalents are fine.

### 5.3 Accent colour algorithms (exact)
**Group and task accent** (`lib/group-accent.ts` + `group-color-presets.ts`):
```
GROUP_COLOR_PRESETS = ["#c62828","#ef6c00","#f9a825","#558b2f","#00796b","#0277bd","#ad1457","#4527a0","#4e342e","#37474f"]
hashGroupId(id):                     // JS: h = Math.imul(31, h) + id.charCodeAt(i); return Math.abs(h)
  h: Int64 = 0
  for each UTF-16 code unit c of id:
      h32 = Int32(truncating: h)             // Math.imul converts its arg with ToInt32
      h = Int64(h32 &* 31 /* Int32 wrapping multiply */) + Int64(c)   // the addition is NOT wrapped
  return abs(h)
groupAccentHex(groupId) = PRESETS[hash(groupId) % 10]
taskAccentHex(taskId)   = PRESETS[hash(taskId) % 10]      // used for ungrouped tasks in billing
resolveGroupAccent({id,color}) = color matches ^#[0-9A-Fa-f]{6}$ ? color : groupAccentHex(id)
hexToRgba(hex, a) / groupAccentSoftBg(hex, a=0.14) = rgba(r,g,b,a)
```
Test vectors:

| id | hash | group preset | race hash | race colour |
|---|---|---|---|---|
| `"00000000-0000-0000-0000-000000000000"` | 1428967488 | `#4e342e` | 1428967488 | `#4f46e5` |
| `"3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c"` | 182518781 | `#ef6c00` | 182518781 | `#ea580c` |
| `"a"` | 97 | `#4527a0` | 97 | `#dc2626` |
| `"abc"` | 96354 | `#00796b` | 96354 | `#db2777` |

Where the accent is used, with its alpha:

| Place | Treatment |
|---|---|
| Task-card group pill | border rgba α 0.92, text = accent |
| Detail and billing badges | text = accent, background α 0.2 |
| Session row wash | α 0.12 |
| Selected row | border α 0.55, background α 0.22 |
| Billing panel | 3 px left border |
| Stats group bars | α 0.85 |

**User race colour** (`lib/bar-race.ts colorForId`) `[UNCOMMITTED]`:
```
RACE_PALETTE = ["#2563eb","#ea580c","#059669","#7c3aed","#db2777","#0891b2","#ca8a04","#dc2626","#4f46e5","#65a30d"]
hash: UInt32 = 0; for c in UTF-16 units: hash = hash &* 31 &+ UInt32(c)   // (hash*31 + c) >>> 0
color = RACE_PALETTE[hash % 10]
initials(name): 0 words → "?"; 1 word → first 2 chars upper; else first char of first + last word, upper
```

**Chart task palette** (Home and Stats): `#3b82f6 #f97316 #10b981 #8b5cf6 #ec4899 #14b8a6`, with Other `#6b7280`.

**Heatmap:** see §1.5.1 (`#e8eee9 #86efac #22c55e #15803d #052e16`).

### 5.4 Formatting helpers (reproduce exactly)
- `formatDuration(ms)` gives `HH:MM:SS` (hours unbounded, zero-padded), used for the running clock.
- `formatDurationWords(ms)`:
  - 0 → "0s"
  - under 1 min → "Ns"
  - under 1 h → "Nm" (**seconds dropped**)
  - "Nh" or "Nh Nm" otherwise

  The optional `{seconds:true}` adds seconds.
- `fmtMs` (Stats): see 1.5. `formatDurationMinutes`, `formatHeatMinutes`, `formatRaceDuration`, `agoLabel`: see above.
- Weeks start on **Monday** everywhere (`weekStartsOn: 1`). Local-day bucketing uses device time. Billing uses **UTC** bucket keys.

---

## 6. `TRACKIFY_IOS_APP_SPEC.md`: summary and staleness
Last touched in commit `164323c` (2026-01-15). It has 1655 lines, and sections repeat twice ("Complete Socket Service Example" and "Data Models" are duplicated).

**Still useful:**
- Base URLs (prod `https://trackify.ranajakub.com`, dev `https://dev.trackify.ranajakub.com`).
- Token flow with Keychain storage.
- Socket `authenticate {token}` → `auth:success`, and the listener patterns in Swift (Socket.IO-Client-Swift with `.path("/socket.io")`, `.forceWebsockets(true)`).
- Live Activities / Dynamic Island design: `ActivityAttributes` holding the task name and start date, with the elapsed time rendered locally via `Text(timerInterval:)`. This is still a good plan.
- The stats and validate-start descriptions are still accurate.

**Outdated or wrong:**
- **Event model:** the spec uses `{createdAt, duration(ms)}`. The real model is **`{from, to}`** ISO timestamps, plus `paymentRecordId` and `paidAmount`. The `POST /api/events` body is `{taskId, name?, from, to, source?}`; `duration` and `createdAt` are rejected or ignored.
- The Task model is missing `taskGroupId` / `taskGroup`. Task list sort is not simply alphabetical in the UI (see 1.2).
- It says "After `timer:stop`, call POST /api/events". This is still conceptually true, but the spec omits:
  - the 60 s minimum and the `{skipped:true}` response
  - crumb absorption
  - the `source:"manual"` difference
  - that POST /api/events itself stops a matching timer
  - the REST timer endpoints (`GET/POST/PATCH/DELETE /api/timer`, which did not exist then)
  - the durable-queue need
- `timer:start` has an optional `startTime` (the spec omits it).
- It lacks the features added since:
  - groups (`/api/groups`)
  - billing (`/api/billing/*`)
  - AI subscriptions
  - AI chat and conversations
  - presence/leaderboard (`/api/presence`)
  - profile / display name
  - visualizations
  - hidden-task restore (only a mention)
  - log-past-time and adjust dialogs
- The overlap-handling description predates crumbs and the manual/timer distinction.
- Treat the spec as historical. **This document supersedes it.**

---

## 7. Gaps and risks for native clients

**Auth and security**
- **G1 (security, high): socket `authenticate {userId}` is unauthenticated.** Anyone can join any user's room and receive their timer and task events, or emit `timer:start` / `timer:stop` as them. Native clients should use `{token}` (which works). The server should drop or verify the `userId` path, for example with a signed short-lived socket token from a `GET /api/socket-token` endpoint for the web.
- **G2: no token refresh or rotation.** Tokens have a fixed 30-day expiry and there is no `/api/auth/refresh`. Native apps must re-prompt for credentials (or silently re-login with stored credentials, which is not recommended). Also missing: listing and revoking devices, and hashed token storage (tokens are stored in plaintext).
- **G3: `POST /api/auth/token` checks only bcrypt.** Users with legacy SHA-256 hashes can log in on the web but **cannot get a token**. Port the legacy branch from `lib/auth.ts`, or rehash on web login.
- **G4:** `POST /api/auth/register` returns no token, so a second call is needed. Also missing:
  - a logged-in password change
  - **in-app account deletion** (required by the App Store, guideline 5.1.1(v))
  - rate limiting on login, token and forgot-password
- **G5: no "who am I" endpoint.** `GET /api/profile` lacks `id`; the user id is returned only by `POST /api/auth/token`. Native apps need the id for "· you" on the leaderboard. Add `id` to `/api/profile`.

**Realtime**
- **G6:** REST mutations for tasks and groups **do not emit socket events**. Only clients relay them (`task:created` / `updated` / `deleted`). Native clients must emit those relays themselves after REST writes, or other devices go stale. Groups have no events at all. Server-side emits would be better.
- **G7:** `presence:changed` is a global, payload-less broadcast, which leaks activity timing to unauthenticated sockets. Presence data requires polling `/api/presence`.
- **G8:** `DELETE /api/tasks/:id` removes the ActiveTimer row but **not the in-memory timer**, and emits nothing. `GET /api/timer` says idle, but socket `timer:request-state` still reports running until someone emits `task:deleted`. `PUT {hidden:true}` does not stop the timer at all.
- **G9:** `timer:request-state` is silent when idle, and there is no `auth:success` for the web path. Use `GET /api/timer` for the ground truth.
- **G10: no push.** There is no APNs or FCM registration, so there are no remote Live Activity updates, no "timer started on another device" push, and no running-too-long reminders. A server-side device-token model plus push-to-start / update would be needed for a Live Activity that works while the app is killed.

**Timer and data model**
- **G11: stopping never saves time server-side.** Starting or switching (`POST /api/timer`, socket `timer:start`) replaces the timer and **silently discards** the previous stretch unless the client POSTs the Event. A widget, menu-bar or watch action that only calls `/api/timer` would lose time. Suggest atomic endpoints `POST /api/timer/stop` (save and stop) and `POST /api/timer/switch`, with an idempotency key.
- **G12: payload size.** `GET /api/tasks` returns every event of every task, and all stats, heatmaps and charts are computed client-side from it. There is no pagination and `/api/events` has no date-range filter (only `taskId`). Native apps (especially the watch, widgets and menu bar) would benefit from `/api/events?from&to`, a server-side daily aggregate (`/api/stats/daily?from&to&tz`), and ETags.
- **G13:** `PUT /api/events/:id` stores the **unclamped** `to` (a future end can be saved). `validate-start` has destructive side effects (it deletes crumbs). Paid events can be edited or deleted without adjusting `PaymentRecord` totals.
- **G14: chat protocol.** `/api/chat` speaks the AI SDK v6 UI-message SSE protocol. Native clients must implement the SSE parser, the message and parts model, and the approval loop (§2.10). Problems:
  - Errors are plain text.
  - Persisted tool parts store `input: {}` (the code reads `tc.args`, but v6 uses `tc.input`), so reloaded conversations lose tool arguments.
  - Client-side approvals are not persisted.
  - The continuation after an approval saves an extra assistant row.
  - Consider a simpler JSON / NDJSON chat endpoint for native clients.
- **G15: time zones.**
  - Billing buckets and summary week/month use **UTC**.
  - AI analytics month keys, the chat tools' `startDate` parsing, and overlap error strings use the **server's local time zone**.
  - Stats, presence and race take an explicit `timezone` param.
  - Native apps should always send `TimeZone.current.identifier` and expect UTC billing keys.
- **G16: web UI gaps worth deciding on for parity.**
  - Web has no UI for: editing or deleting events (only via AI chat), deleting conversations, managing custom presets, or `aiTargetHoursPer100Czk`.
  - `roundingMins` is dead.
  - The APIs for these exist, so native apps can go beyond the web.
- **G17:** "Team" = all users in the DB. `/api/presence` and `/api/visualizations/race` expose every user's name and hours to every user. There is no org or team scoping or opt-out.
- **G18:** Uncommitted work: the presence `range` param and `isCurrent` field and the whole Visualizations feature may not be deployed. Check the production build before depending on `/api/visualizations/race` or `range=week|month`. HEAD `/api/presence` responds `{tracking, leaderboard, day, isToday}` and treats every request as a day.
