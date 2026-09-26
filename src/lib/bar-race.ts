import { liveOverlapMs } from "@/lib/live-timer";

export const RACE_PALETTE = [
  "#2563eb",
  "#ea580c",
  "#059669",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#ca8a04",
  "#dc2626",
  "#4f46e5",
  "#65a30d",
] as const;

export type RaceEvent = { userId: string; from: number; to: number };
export type RaceUser = { id: string; name: string; color: string };
export type RaceRow = RaceUser & { ms: number };

export function colorForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return RACE_PALETTE[hash % RACE_PALETTE.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function indexEvents(events: RaceEvent[]) {
  const map = new Map<string, RaceEvent[]>();
  for (const event of events) {
    const list = map.get(event.userId);
    if (list) list.push(event);
    else map.set(event.userId, [event]);
  }
  return map;
}

export function mergeIntervals(events: RaceEvent[]): RaceEvent[] {
  const byUser = indexEvents(events);
  const out: RaceEvent[] = [];
  for (const [userId, list] of Array.from(byUser.entries())) {
    const sorted = [...list].sort((a, b) => a.from - b.from || a.to - b.to);
    let current = { userId, from: sorted[0].from, to: sorted[0].to };
    for (let i = 1; i < sorted.length; i += 1) {
      const event = sorted[i];
      if (event.from <= current.to) {
        current.to = Math.max(current.to, event.to);
      } else {
        out.push(current);
        current = { userId, from: event.from, to: event.to };
      }
    }
    out.push(current);
  }
  return out;
}

export function totalsAt(
  eventsByUser: Map<string, RaceEvent[]>,
  users: RaceUser[],
  rangeStart: number,
  at: number
): RaceRow[] {
  return users
    .map((user) => {
      let ms = 0;
      const list = eventsByUser.get(user.id);
      if (list) {
        for (const event of list) {
          ms += liveOverlapMs(event.from, event.to, rangeStart, at);
        }
      }
      return { ...user, ms };
    })
    .sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name));
}

export function formatRaceDuration(ms: number) {
  if (ms <= 0) return "0m";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatPlayClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
