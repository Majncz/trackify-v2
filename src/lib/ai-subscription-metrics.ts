import type { PrismaClient } from "@prisma/client";
import { eventToBillingSession, type BillingTaskLike } from "./billing";
import { AI_SUBSCRIPTION_BUILTIN_DEFS } from "./ai-subscription-default-presets";

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

export function effectiveWindowEnd(endsAt: Date | null, now: Date): Date {
  return endsAt ?? now;
}

/**
 * Sum tracked (timer) hours for events that overlap [windowStart, windowEnd].
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

export function trackedHoursForPeriod(
  events: { taskId: string; from: Date; to: Date }[],
  linkedTaskIdSet: Set<string>,
  windowStart: Date,
  windowEnd: Date
): number {
  let ms = 0;
  for (const ev of events) {
    if (!linkedTaskIdSet.has(ev.taskId)) continue;
    ms += overlapMs(ev.from, ev.to, windowStart, windowEnd);
  }
  return ms / 3_600_000;
}

/**
 * Days for burn rate (minimum fraction of a day to avoid div-by-zero).
 */
export function durationDaysForBurn(startsAt: Date, windowEnd: Date): number {
  const raw = (windowEnd.getTime() - startsAt.getTime()) / 86_400_000;
  return Math.max(raw, 1 / 24);
}

export function hoursPer100Czk(
  hours: number,
  priceInCzk: number | null
): number | null {
  if (hours <= 0 || priceInCzk == null || !Number.isFinite(priceInCzk)) {
    return null;
  }
  if (priceInCzk <= 0) return null;
  return (100 * hours) / priceInCzk;
}

/**
 * 100% = meeting average (actual === target). &gt;100% = better than target.
 */
export function effectivenessPercent(
  actualHoursPer100Czk: number | null,
  targetHoursPer100Czk: number | null,
  medianFallback: number | null
): number | null {
  const target =
    targetHoursPer100Czk != null && targetHoursPer100Czk > 0
      ? targetHoursPer100Czk
      : medianFallback != null && medianFallback > 0
        ? medianFallback
        : null;
  if (actualHoursPer100Czk == null || target == null || target <= 0) {
    return null;
  }
  return Math.round((actualHoursPer100Czk / target) * 1000) / 10;
}

export function medianHoursPer100Czk(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  if (v.length % 2 === 1) return v[mid]!;
  return (v[mid - 1]! + v[mid]!) / 2;
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
 * Aggregated paid ratio for billable time on linked tasks overlapping the AI period window.
 * Y-axis for correlation chart: paid earnings / (paid + unpaid billable earnings), 0–1.
 */
export function billablePaidShareInWindow(
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
): { paid: number; unpaid: number; ratio: number | null } {
  let paid = 0;
  let unpaid = 0;

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
    const earningsPortion = row.earnings * frac;
    if (row.isPaid) paid += earningsPortion;
    else unpaid += earningsPortion;
  }

  const total = paid + unpaid;
  if (total <= 0) return { paid: 0, unpaid: 0, ratio: null };
  return { paid, unpaid, ratio: paid / total };
}

export type AiPeriodMetrics = {
  linkedTaskCount: number;
  trackedHours: number;
  eventsInWindow: number;
  costPerHour: number | null;
  costPerLinkedTask: number | null;
  burnPerDayNative: number;
  durationDays: number;
  hoursPer100Czk: number | null;
  effectivenessPercent: number | null;
  isActive: boolean;
};

export function buildAiPeriodMetrics(args: {
  price: number;
  startsAt: Date;
  endsAt: Date | null;
  now: Date;
  linkedTaskIds: string[];
  events: { taskId: string; from: Date; to: Date }[];
  priceInCzk: number | null;
  userTargetHoursPer100Czk: number | null;
  medianHoursPer100Czk: number | null;
}): AiPeriodMetrics {
  const windowEnd = effectiveWindowEnd(args.endsAt, args.now);
  const taskSet = new Set(args.linkedTaskIds);
  const trackedHours = trackedHoursForPeriod(
    args.events,
    taskSet,
    args.startsAt,
    windowEnd
  );

  let eventsInWindow = 0;
  for (const ev of args.events) {
    if (!taskSet.has(ev.taskId)) continue;
    if (overlapMs(ev.from, ev.to, args.startsAt, windowEnd) > 0) {
      eventsInWindow += 1;
    }
  }

  const linkedCount = args.linkedTaskIds.length;
  const costPerHour =
    trackedHours > 0 ? args.price / trackedHours : null;
  const costPerLinkedTask =
    linkedCount > 0 ? args.price / linkedCount : null;
  const durationDays = durationDaysForBurn(args.startsAt, windowEnd);
  const burnPerDayNative = args.price / durationDays;

  const hp100 = hoursPer100Czk(trackedHours, args.priceInCzk);
  const eff = effectivenessPercent(
    hp100,
    args.userTargetHoursPer100Czk,
    args.medianHoursPer100Czk
  );

  const active =
    !args.endsAt || args.endsAt.getTime() > args.now.getTime();

  return {
    linkedTaskCount: linkedCount,
    trackedHours:
      Math.round(trackedHours * 100) / 100,
    eventsInWindow,
    costPerHour:
      costPerHour != null
        ? Math.round(costPerHour * 100) / 100
        : null,
    costPerLinkedTask:
      costPerLinkedTask != null
        ? Math.round(costPerLinkedTask * 100) / 100
        : null,
    burnPerDayNative:
      Math.round(burnPerDayNative * 100) / 100,
    durationDays:
      Math.round(durationDays * 100) / 100,
    hoursPer100Czk: hp100 != null ? Math.round(hp100 * 100) / 100 : null,
    effectivenessPercent: eff,
    isActive: active,
  };
}
