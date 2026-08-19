const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const PAST_LOOKBACK = 40 * HOUR;
const DEFAULT_MS = 25 * MINUTE;
export const VIEW_WINDOW = 90 * MINUTE;

export type TimeSpan = { from: number; to: number };

export function typicalDurationMs(events: Array<{ from: string | number; to: string | number }>) {
  const durations = events
    .map((event) => new Date(event.to).getTime() - new Date(event.from).getTime())
    .filter((ms) => ms >= MINUTE && ms <= 8 * HOUR)
    .sort((a, b) => a - b);
  if (durations.length === 0) return DEFAULT_MS;
  return durations[Math.floor(durations.length / 2)];
}

export function mergeBusy(spans: TimeSpan[], earliest: number, latest: number): TimeSpan[] {
  const busy = spans
    .filter((span) => span.to > earliest && span.from < latest)
    .sort((a, b) => a.from - b.from);
  const merged: TimeSpan[] = [];
  for (const span of busy) {
    const last = merged[merged.length - 1];
    if (!last || span.from > last.to) merged.push({ ...span });
    else last.to = Math.max(last.to, span.to);
  }
  return merged;
}

export function listGaps(earliest: number, latest: number, busy: TimeSpan[]): TimeSpan[] {
  const merged = mergeBusy(busy, earliest, latest);
  const gaps: TimeSpan[] = [];
  let cursor = earliest;
  for (const span of merged) {
    if (span.from > cursor) gaps.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < latest) gaps.push({ from: cursor, to: latest });
  return gaps.filter((gap) => gap.to - gap.from >= MINUTE);
}

function gapDistance(anchor: number, gap: TimeSpan) {
  if (anchor >= gap.from && anchor <= gap.to) return 0;
  if (anchor < gap.from) return gap.from - anchor;
  return anchor - gap.to;
}

function fitInGap(gap: TimeSpan, duration: number, anchor: number, asEnd: boolean) {
  const room = gap.to - gap.from;
  const dur = Math.min(Math.max(MINUTE, duration), room);
  if (asEnd) {
    const end = Math.min(gap.to, Math.max(gap.from + dur, anchor));
    return { start: end - dur, end };
  }
  const start = Math.max(gap.from, Math.min(gap.to - dur, anchor));
  return { start, end: start + dur };
}

export function relocateToTime(input: {
  anchor: number;
  duration: number;
  asEnd?: boolean;
  earliest: number;
  latest: number;
  busy: TimeSpan[];
}): { start: number; end: number } | null {
  const gaps = listGaps(input.earliest, input.latest, input.busy);
  if (gaps.length === 0) return null;
  let best = gaps[0];
  let bestDist = gapDistance(input.anchor, best);
  for (const gap of gaps) {
    const dist = gapDistance(input.anchor, gap);
    if (dist < bestDist) {
      best = gap;
      bestDist = dist;
    }
  }
  return fitInGap(best, input.duration, input.anchor, Boolean(input.asEnd));
}

export function viewAround(
  start: number,
  end: number,
  earliest: number,
  latest: number,
  windowMs = VIEW_WINDOW
) {
  const span = Math.max(windowMs, end - start + 20 * MINUTE);
  let from = (start + end) / 2 - span / 2;
  let to = from + span;
  if (to > latest) {
    to = latest;
    from = to - span;
  }
  if (from < earliest) {
    from = earliest;
    to = Math.min(latest, from + span);
  }
  if (start < from) from = Math.max(earliest, start - 10 * MINUTE);
  if (end > to) to = Math.min(latest, end + 10 * MINUTE);
  return { viewFrom: from, viewTo: to };
}

export function suggestPastRange(input: {
  now: number;
  events: Array<{ from: string | number; to: string | number }>;
  runningStart?: number | null;
  preferredMs?: number;
}) {
  const preferred = Math.max(MINUTE, input.preferredMs ?? DEFAULT_MS);
  const earliest = input.now - PAST_LOOKBACK;
  const busy: TimeSpan[] = input.events.map((event) => ({
    from: new Date(event.from).getTime(),
    to: new Date(event.to).getTime(),
  }));
  if (input.runningStart) {
    busy.push({ from: input.runningStart, to: input.now });
  }

  const gaps = listGaps(earliest, input.now, busy);
  for (let i = gaps.length - 1; i >= 0; i--) {
    const gap = gaps[i];
    const room = gap.to - gap.from;
    if (room >= preferred) {
      return { start: gap.to - preferred, end: gap.to };
    }
    if (room >= MINUTE) {
      return { start: gap.from, end: gap.to };
    }
  }

  return { start: input.now - preferred, end: input.now };
}
