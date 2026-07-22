import type { PrismaClient } from "@prisma/client";
import {
  differenceInCalendarMonths,
  eachMonthOfInterval,
  format,
  startOfMonth,
} from "date-fns";
import { eventToBillingSession, type BillingTaskLike } from "./billing";
import { AI_SUBSCRIPTION_BUILTIN_DEFS } from "./ai-subscription-default-presets";

export const AI_BILLING_KIND_PURCHASE = "purchase";
export const AI_BILLING_KIND_RECURRING_MONTHLY = "recurring_monthly";

export type AiBillingKindValue =
  | typeof AI_BILLING_KIND_PURCHASE
  | typeof AI_BILLING_KIND_RECURRING_MONTHLY;

export function normalizeAiBillingKind(
  raw: string | null | undefined
): AiBillingKindValue {
  return raw === AI_BILLING_KIND_RECURRING_MONTHLY
    ? AI_BILLING_KIND_RECURRING_MONTHLY
    : AI_BILLING_KIND_PURCHASE;
}

export function overlapMs(
  aFrom: Date,
  aTo: Date,
  bFrom: Date,
  bTo: Date
): number {
  const s = Math.max(aFrom.getTime(), bFrom.getTime());
  const e = Math.min(aTo.getTime(), bTo.getTime());
  return Math.max(0, e - s);
}

/**
 * End of the interval where paid credits were usable: capped by wall-clock now,
 * optional subscription calendar end, and optional token/credit depletion time.
 */
export function subscriptionUsageWindowEnd(
  calendarEndsAt: Date | null,
  depletedAt: Date | null,
  now: Date
): Date {
  let endMs = now.getTime();
  if (calendarEndsAt != null && Number.isFinite(calendarEndsAt.getTime())) {
    endMs = Math.min(endMs, calendarEndsAt.getTime());
  }
  if (depletedAt != null && Number.isFinite(depletedAt.getTime())) {
    endMs = Math.min(endMs, depletedAt.getTime());
  }
  return new Date(endMs);
}

/** Inclusive calendar months touched by [start, end]. */
export function billedMonthsInclusive(start: Date, end: Date): number {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return 0;
  }
  if (end.getTime() < start.getTime()) return 0;
  return Math.max(1, differenceInCalendarMonths(end, start) + 1);
}

/** Total native-currency spend attributed to this entry (uses billing kind + usage window). */
export function aiBillingSpendNativeTotal(args: {
  startsAt: Date;
  calendarEndsAt: Date | null;
  depletedAt: Date | null;
  now: Date;
  unitPrice: number;
  billingKind: AiBillingKindValue;
}): number {
  const end = subscriptionUsageWindowEnd(
    args.calendarEndsAt,
    args.depletedAt,
    args.now
  );
  if (end.getTime() < args.startsAt.getTime()) return 0;
  if (args.billingKind === AI_BILLING_KIND_RECURRING_MONTHLY) {
    return billedMonthsInclusive(args.startsAt, end) * args.unitPrice;
  }
  return args.unitPrice;
}

export function accumulateAiBillingIntoMonthTotals(args: {
  monthTotals: Map<string, number>;
  startsAt: Date;
  calendarEndsAt: Date | null;
  depletedAt: Date | null;
  now: Date;
  unitPrice: number;
  billingKind: AiBillingKindValue;
  mult: number;
}): void {
  const end = subscriptionUsageWindowEnd(
    args.calendarEndsAt,
    args.depletedAt,
    args.now
  );
  if (end.getTime() < args.startsAt.getTime()) return;

  if (args.billingKind === AI_BILLING_KIND_RECURRING_MONTHLY) {
    const intervalStart = startOfMonth(args.startsAt);
    const intervalEnd = startOfMonth(end);
    if (intervalStart.getTime() > intervalEnd.getTime()) return;
    for (const m of eachMonthOfInterval({
      start: intervalStart,
      end: intervalEnd,
    })) {
      const key = format(m, "yyyy-MM");
      args.monthTotals.set(
        key,
        (args.monthTotals.get(key) ?? 0) + args.unitPrice * args.mult
      );
    }
  } else {
    const key = format(args.startsAt, "yyyy-MM");
    args.monthTotals.set(
      key,
      (args.monthTotals.get(key) ?? 0) + args.unitPrice * args.mult
    );
  }
}

export function validateAiBillingDepletedAt(args: {
  startsAt: Date;
  calendarEndsAt: Date | null;
  depletedAt: Date | null;
}): string | null {
  if (!args.depletedAt || !Number.isFinite(args.depletedAt.getTime())) {
    return null;
  }
  if (args.depletedAt.getTime() < args.startsAt.getTime()) {
    return "Credits depleted time must be on or after the start time";
  }
  if (
    args.calendarEndsAt &&
    args.calendarEndsAt.getTime() >= args.startsAt.getTime() &&
    args.depletedAt.getTime() > args.calendarEndsAt.getTime()
  ) {
    return "Credits depleted time cannot be after the subscription end date";
  }
  return null;
}

/**
 * Sum tracked (timer) hours for events that overlap [windowStart, windowEnd].
 * (Unused by AI metrics after mutual timer allocation — kept as a standalone helper.)
 */
export function trackedHoursInWindow(
  events: { from: Date; to: Date }[],
  windowStart: Date,
  windowEnd: Date
): number {
  let ms = 0;
  for (const ev of events) {
    ms += overlapMs(ev.from, ev.to, windowStart, windowEnd);
  }
  return ms / 3_600_000;
}

/**
 * Timeline slice for allocating timer duration when several AI billing windows overlap.
 *
 * When several billing rows cover the same clock time, timer minutes are credited to **one**
 * row only—the earliest **startsAt** wins (ties broken by **period id**). Sessions outside every
 * window are ignored here. Nothing is keyed off “linked tasks”; it is automatic from dates.
 *
 * **Money** totals are unchanged each row still stacks spend; **only** tracked-hour metrics use
 * this split when several billing periods overlap so summed timer credit across concurrent rows
 * does not double-count wall-clock overlaps.
 */
export type AiBillingActiveTimeline = {
  periodId: string;
  startsAt: Date;
  windowEnd: Date;
};

export type AiTimerSliceForAllocation = {
  eventId: string;
  taskId: string;
  from: Date;
  to: Date;
};

export type ExclusiveTimerCredit = {
  trackedMs: number;
  eventIds: Set<string>;
  taskIds: Set<string>;
};

function winnerPeriodIdAt(
  midMs: number,
  windows: AiBillingActiveTimeline[]
): string | null {
  const overlapping = windows.filter((w) => {
    const s = w.startsAt.getTime();
    const e = w.windowEnd.getTime();
    return midMs >= s && midMs <= e;
  });
  if (overlapping.length === 0) return null;
  overlapping.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.periodId.localeCompare(b.periodId)
  );
  return overlapping[0]!.periodId;
}

/** Split overlapping timer overlap across billing rows (earliest-active row wins each slice). */
export function allocateTimerMillisExclusiveEarliestStartsAt(
  events: AiTimerSliceForAllocation[],
  periodWindows: AiBillingActiveTimeline[]
): Map<string, ExclusiveTimerCredit> {
  const byPeriod = new Map<string, ExclusiveTimerCredit>();

  const sortedWindows = [...periodWindows].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.periodId.localeCompare(b.periodId)
  );

  function creditRow(
    periodId: string,
    msDelta: number,
    eventId: string,
    taskId: string
  ) {
    if (msDelta <= 0 || !Number.isFinite(msDelta)) return;
    let row = byPeriod.get(periodId);
    if (!row) {
      row = {
        trackedMs: 0,
        eventIds: new Set<string>(),
        taskIds: new Set<string>(),
      };
      byPeriod.set(periodId, row);
    }
    row.trackedMs += msDelta;
    row.eventIds.add(eventId);
    row.taskIds.add(taskId);
  }

  for (const ev of events) {
    const ef = ev.from.getTime();
    const et = ev.to.getTime();
    if (!(et > ef && Number.isFinite(ef))) continue;

    const points = new Set<number>();
    points.add(ef);
    points.add(et);
    for (const p of sortedWindows) {
      const ws = p.startsAt.getTime();
      const we = p.windowEnd.getTime();
      const lo = Math.max(ef, ws);
      const hi = Math.min(et, we);
      if (hi > lo) {
        points.add(lo);
        points.add(hi);
      }
    }

    const arr = Array.from(points)
      .filter((t) => t >= ef && t <= et)
      .sort((x, y) => x - y);

    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]!;
      const b = arr[i + 1]!;
      const segmentLen = b - a;
      if (!(segmentLen > 0)) continue;
      const mid = a + segmentLen / 2;
      const wid = winnerPeriodIdAt(mid, sortedWindows);
      if (wid === null) continue;
      creditRow(wid, segmentLen, ev.eventId, ev.taskId);
    }
  }

  return byPeriod;
}

/**
 * How many whole calendar days the billing row has been active (start through
 * today/end/depletion). Always at least 1.
 */
export function elapsedDaysForActiveBillingSpan(
  startsAt: Date,
  windowEnd: Date
): number {
  const ms = windowEnd.getTime() - startsAt.getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export async function ensureBuiltInAiPresets(
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  const n = await prisma.aiSubscriptionPreset.count({
    where: { userId, isBuiltIn: true },
  });
  if (n > 0) return;
  await prisma.aiSubscriptionPreset.createMany({
    data: AI_SUBSCRIPTION_BUILTIN_DEFS.map((p) => ({
      userId,
      name: p.name,
      providerKey: p.providerKey,
      isBuiltIn: true,
      sortOrder: p.sortOrder,
    })),
  });
}

type BillingCtx = {
  taskId: string;
  taskName: string;
  taskGroup: {
    id: string;
    name: string;
    color?: string | null;
  } | null;
  billing: BillingTaskLike;
};

export type { BillingCtx };

/**
 * Paid billable earnings from sessions on tasks enrolled in Billing that overlap
 * [windowStart, windowEnd]. Aggregated per billing task currency. Only paid sessions
 * are counted — once a row is ended/depleted the window is fixed so the number
 * is stable ("final for that run").
 */
export function billablePaidEarningsInWindow(
  events: {
    from: Date;
    to: Date;
    taskId: string;
    paymentRecordId: string | null;
    name: string;
    paidAmount: number | null;
  }[],
  billingByTaskId: Map<string, BillingCtx>,
  windowStart: Date,
  windowEnd: Date
): Record<string, number> {
  const byCurrency: Record<string, number> = {};

  for (const ev of events) {
    const ctx = billingByTaskId.get(ev.taskId);
    if (!ctx) continue;

    const overlap = overlapMs(ev.from, ev.to, windowStart, windowEnd);
    if (overlap <= 0) continue;

    const totalMs = ev.to.getTime() - ev.from.getTime();
    if (totalMs <= 0) continue;

    const frac = overlap / totalMs;
    const row = eventToBillingSession(
      {
        id: "synthetic",
        from: ev.from,
        to: ev.to,
        name: ev.name,
        taskId: ev.taskId,
        paymentRecordId: ev.paymentRecordId,
        paidAmount: ev.paidAmount,
      },
      ctx.taskName,
      ctx.billing,
      null,
      ctx.taskGroup
    );
    if (!row.isPaid) continue;

    const currency = ctx.billing.currency;
    byCurrency[currency] = (byCurrency[currency] ?? 0) + row.earnings * frac;
  }

  return byCurrency;
}

export type AiPeriodMetrics = {
  /** Tasks receiving any credited timer overlap under this billing row */
  tasksWithTrackedTime: number;
  /** Timer hours credited to this row (overlapping rows split automatically — earlier start wins) */
  trackedHours: number;
  /** Distinct timers that credited time to this row */
  eventsInWindow: number;
  durationDays: number;
  isActive: boolean;
};

export function buildAiPeriodMetrics(args: {
  startsAt: Date;
  windowEnd: Date;
  trackedHours: number;
  tasksWithTrackedTime: number;
  eventsInWindow: number;
  now: Date;
  calendarEndsAt: Date | null;
  depletedAt: Date | null;
}): AiPeriodMetrics {
  const trackedHoursRounded = Math.round(args.trackedHours * 100) / 100;

  const durationDays = elapsedDaysForActiveBillingSpan(
    args.startsAt,
    args.windowEnd
  );

  const calendarActive =
    args.calendarEndsAt == null ||
    args.calendarEndsAt.getTime() > args.now.getTime();
  const tokensActive =
    args.depletedAt == null ||
    args.depletedAt.getTime() > args.now.getTime();
  const isActive = calendarActive && tokensActive;

  return {
    tasksWithTrackedTime: args.tasksWithTrackedTime,
    trackedHours: trackedHoursRounded,
    eventsInWindow: args.eventsInWindow,
    durationDays,
    isActive,
  };
}
