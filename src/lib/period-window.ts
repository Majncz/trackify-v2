import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type LeaderboardRange = "day" | "week" | "month";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_STARTS_ON = 1 as const;

export function parseLeaderboardRange(value: string | null): LeaderboardRange {
  if (value === "week" || value === "month") return value;
  return "day";
}

export function periodWindowUtc(
  timezone: string,
  range: LeaderboardRange,
  dayKey: string | null
) {
  const nowInTz = toZonedTime(new Date(), timezone);
  const todayKey = format(startOfDay(nowInTz), "yyyy-MM-dd");
  const key = dayKey && DAY_KEY.test(dayKey) && dayKey <= todayKey ? dayKey : todayKey;
  const [year, month, day] = key.split("-").map(Number);
  const wall = startOfDay(nowInTz);
  wall.setFullYear(year, month - 1, day);
  wall.setHours(0, 0, 0, 0);

  let startWall = startOfDay(wall);
  let endWall = endOfDay(wall);
  if (range === "week") {
    startWall = startOfWeek(wall, { weekStartsOn: WEEK_STARTS_ON });
    endWall = endOfWeek(wall, { weekStartsOn: WEEK_STARTS_ON });
  } else if (range === "month") {
    startWall = startOfMonth(wall);
    endWall = endOfMonth(wall);
  }

  const start = fromZonedTime(startWall, timezone);
  const end = fromZonedTime(endWall, timezone);
  const now = Date.now();

  return {
    start,
    end,
    day: key,
    range,
    isCurrent: now >= start.getTime() && now <= end.getTime(),
    isToday: key === todayKey,
  };
}

function wallFromKey(nowInTz: Date, key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const wall = startOfDay(nowInTz);
  wall.setFullYear(year, month - 1, day);
  wall.setHours(0, 0, 0, 0);
  return wall;
}

export function customRangeUtc(
  timezone: string,
  fromKey: string | null,
  toKey: string | null,
  maxDays = 93
) {
  const nowInTz = toZonedTime(new Date(), timezone);
  const todayKey = format(startOfDay(nowInTz), "yyyy-MM-dd");
  const fallbackFrom = format(addDays(startOfDay(nowInTz), -6), "yyyy-MM-dd");
  let from = fromKey && DAY_KEY.test(fromKey) ? fromKey : fallbackFrom;
  let to = toKey && DAY_KEY.test(toKey) ? toKey : todayKey;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (to > todayKey) to = todayKey;
  const fromWall = wallFromKey(nowInTz, from);
  const toWall = wallFromKey(nowInTz, to);
  if (differenceInCalendarDays(toWall, fromWall) > maxDays) {
    from = format(addDays(toWall, -maxDays), "yyyy-MM-dd");
  }
  const startWall = wallFromKey(nowInTz, from);
  const endWall = wallFromKey(nowInTz, to);
  return {
    start: fromZonedTime(startOfDay(startWall), timezone),
    end: fromZonedTime(endOfDay(endWall), timezone),
    from,
    to,
  };
}
