import {
  startOfDay,
  startOfWeek,
  endOfDay,
  endOfWeek,
  addDays,
  addMilliseconds,
  format,
  eachDayOfInterval,
} from "date-fns";
import type { BillingSessionRow } from "@/lib/billing";

export type YearlyContributionDayEvent = {
  taskName: string;
  from: Date;
  to: Date;
};

export type YearlyContributionData = {
  weeks: Date[][];
  grid: number[][];
  maxMinutes: number;
  startDate: Date;
  endDate: Date;
  dayTaskMinutes: Map<string, Record<string, number>>;
  /** Set when built from billing sessions (tooltip + click) */
  billingDayEarnings?: Map<string, number>;
  billingDayCurrency?: Map<string, string>;
};

export function getOverlapDuration(
  eventFrom: Date,
  eventTo: Date,
  intervalStart: Date,
  intervalEnd: Date
): number {
  if (eventTo <= intervalStart || eventFrom >= intervalEnd) {
    return 0;
  }

  const overlapStart = eventFrom > intervalStart ? eventFrom : intervalStart;
  const overlapEnd = eventTo < intervalEnd ? eventTo : intervalEnd;

  return Math.max(0, overlapEnd.getTime() - overlapStart.getTime());
}

/** Every calendar day overlapped by a billing session (local), with overlap ms and session length. */
export function forEachBillingSessionCalendarDay(
  s: BillingSessionRow,
  fn: (args: {
    day: Date;
    dayKey: string;
    dayStart: Date;
    dayEnd: Date;
    overlap: number;
    totalMs: number;
  }) => void
): void {
  const from = new Date(s.from);
  const to = new Date(s.to);
  const totalMs = Math.max(1, to.getTime() - from.getTime());
  let d = startOfDay(from);
  const last = startOfDay(to);
  while (d <= last) {
    const dayStart = startOfDay(d);
    const dayEnd = endOfDay(d);
    const overlap = getOverlapDuration(from, to, dayStart, dayEnd);
    if (overlap > 0) {
      fn({
        day: d,
        dayKey: format(d, "yyyy-MM-dd"),
        dayStart,
        dayEnd,
        overlap,
        totalMs,
      });
    }
    d = addDays(d, 1);
  }
}

/** Same grid algorithm as the dashboard “Yearly” time chart (local calendar days). */
export function buildYearlyContributionFromEventsByDate(
  eventsByDate: Map<string, YearlyContributionDayEvent[]>,
  options?: { calendarEndDay?: Date }
): YearlyContributionData | null {
  let hasAny = false;
  let minT = Infinity;

  eventsByDate.forEach((list) => {
    for (const ev of list) {
      hasAny = true;
      minT = Math.min(minT, ev.from.getTime(), ev.to.getTime());
    }
  });

  if (!hasAny) return null;

  const earliestDate = new Date(minT);
  const rangeEnd = endOfDay(options?.calendarEndDay ?? new Date());

  const startDate = startOfWeek(startOfDay(earliestDate), { weekStartsOn: 1 });
  const endDate = endOfWeek(rangeEnd, { weekStartsOn: 1 });

  const allDays = eachDayOfInterval({ start: startDate, end: endDate });

  const dayMinutes = new Map<string, number>();
  const dayTaskMinutes = new Map<string, Record<string, number>>();

  allDays.forEach((day) => {
    const dayKey = format(day, "yyyy-MM-dd");
    const dayEvents = eventsByDate.get(dayKey) || [];
    const byTask: Record<string, number> = {};
    let totalMinutes = 0;
    dayEvents.forEach(({ taskName, from, to }) => {
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);
      const overlap = getOverlapDuration(from, to, dayStart, dayEnd);
      const mins = overlap / 60000;
      totalMinutes += mins;
      byTask[taskName] = (byTask[taskName] || 0) + mins;
    });
    dayMinutes.set(dayKey, totalMinutes);
    dayTaskMinutes.set(dayKey, byTask);
  });

  const weeks: Date[][] = [];
  let currentWeekStart = startDate;

  while (currentWeekStart <= endDate) {
    const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(currentWeekStart, i);
      if (day <= endDate && day >= startDate) {
        week.push(day);
      } else {
        week.push(day);
      }
    }
    weeks.push(week);
    currentWeekStart = addDays(weekEnd, 1);
  }

  const grid: number[][] = [];
  let maxMinutes = 0;

  for (let row = 0; row < 7; row++) {
    grid[row] = [];
  }

  weeks.forEach((week, weekIdx) => {
    week.forEach((day, dayIdx) => {
      const dayKey = format(day, "yyyy-MM-dd");
      const minutes = dayMinutes.get(dayKey) || 0;
      grid[dayIdx][weekIdx] = minutes;
      maxMinutes = Math.max(maxMinutes, minutes);
    });
  });

  return {
    weeks,
    grid,
    maxMinutes: maxMinutes || 1,
    startDate,
    endDate,
    dayTaskMinutes,
  };
}

/** Empty GitHub-style grid from Jan 1 (week-aligned, same calendar year as `end`) through end of week of `end`. */
export function buildEmptyYearlyContributionThroughDate(
  calendarEndDay: Date
): YearlyContributionData {
  const end = endOfDay(calendarEndDay);
  const startDate = startOfWeek(
    startOfDay(new Date(end.getFullYear(), 0, 1)),
    { weekStartsOn: 1 }
  );
  const endDate = endOfWeek(end, { weekStartsOn: 1 });

  const allDays = eachDayOfInterval({ start: startDate, end: endDate });
  const dayTaskMinutes = new Map<string, Record<string, number>>();

  allDays.forEach((day) => {
    dayTaskMinutes.set(format(day, "yyyy-MM-dd"), {});
  });

  const weeks: Date[][] = [];
  let currentWeekStart = startDate;

  while (currentWeekStart <= endDate) {
    const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(addDays(currentWeekStart, i));
    }
    weeks.push(week);
    currentWeekStart = addDays(weekEnd, 1);
  }

  const grid: number[][] = [];
  for (let row = 0; row < 7; row++) {
    grid[row] = [];
  }

  weeks.forEach((week, weekIdx) => {
    week.forEach((day, dayIdx) => {
      grid[dayIdx][weekIdx] = 0;
    });
  });

  return {
    weeks,
    grid,
    maxMinutes: 1,
    startDate,
    endDate,
    dayTaskMinutes,
  };
}

/** Empty GitHub-style grid from Jan 1 (week-aligned) through end of this week (for “no sessions yet”). */
export function buildEmptyYearlyContributionThroughToday(): YearlyContributionData {
  return buildEmptyYearlyContributionThroughDate(new Date());
}

/**
 * Billable heatmap: GitHub-style yearly grid (same as home “Yearly” time chart).
 * Optionally pass `calendarEndDay` so the grid matches a bounded ledger filter (otherwise it ends on today).
 */
export function buildYearlyContributionFromBillingSessions(
  sessions: BillingSessionRow[],
  options?: { calendarEndDay?: Date }
): YearlyContributionData {
  const eventsByDate = new Map<string, YearlyContributionDayEvent[]>();
  const dayEarnings = new Map<string, number>();
  const dayCurrency = new Map<string, string>();

  for (const s of sessions) {
    forEachBillingSessionCalendarDay(s, ({ dayKey, dayStart, dayEnd, overlap, totalMs }) => {
      const billableDayMs = (overlap / totalMs) * s.durationMinutes * 60_000;
      const segEnd = addMilliseconds(dayStart, billableDayMs);
      const clipTo = segEnd > dayEnd ? dayEnd : segEnd;
      if (dayStart < clipTo) {
        const list = eventsByDate.get(dayKey) ?? [];
        list.push({
          taskName: s.taskName,
          from: dayStart,
          to: clipTo,
        });
        eventsByDate.set(dayKey, list);
      }

      const earn = (overlap / totalMs) * s.earnings;
      dayEarnings.set(dayKey, (dayEarnings.get(dayKey) || 0) + earn);
      dayCurrency.set(dayKey, s.currency);
    });
  }

  const base =
    buildYearlyContributionFromEventsByDate(eventsByDate, {
      calendarEndDay: options?.calendarEndDay,
    }) ??
    (options?.calendarEndDay
      ? buildEmptyYearlyContributionThroughDate(options.calendarEndDay)
      : buildEmptyYearlyContributionThroughToday());

  return {
    ...base,
    billingDayEarnings: dayEarnings,
    billingDayCurrency: dayCurrency,
  };
}
