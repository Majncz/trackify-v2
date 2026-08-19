const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const PAST_LOOKBACK = 40 * HOUR;
const DEFAULT_MS = 25 * MINUTE;

export function typicalDurationMs(events: Array<{ from: string | number; to: string | number }>) {
  const durations = events
    .map((event) => new Date(event.to).getTime() - new Date(event.from).getTime())
    .filter((ms) => ms >= MINUTE && ms <= 8 * HOUR)
    .sort((a, b) => a - b);
  if (durations.length === 0) return DEFAULT_MS;
  return durations[Math.floor(durations.length / 2)];
}

export function suggestPastRange(input: {
  now: number;
  events: Array<{ from: string | number; to: string | number }>;
  runningStart?: number | null;
  preferredMs?: number;
}) {
  const preferred = Math.max(MINUTE, input.preferredMs ?? DEFAULT_MS);
  const earliest = input.now - PAST_LOOKBACK;
  const busy = input.events
    .map((event) => ({
      from: new Date(event.from).getTime(),
      to: new Date(event.to).getTime(),
    }))
    .filter((span) => span.to > earliest && span.from < input.now);

  if (input.runningStart) {
    busy.push({ from: input.runningStart, to: input.now });
  }

  busy.sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const span of busy) {
    const last = merged[merged.length - 1];
    if (!last || span.from > last.to) merged.push({ ...span });
    else last.to = Math.max(last.to, span.to);
  }

  const gaps: Array<{ from: number; to: number }> = [];
  let cursor = earliest;
  for (const span of merged) {
    if (span.from > cursor) gaps.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < input.now) gaps.push({ from: cursor, to: input.now });

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
