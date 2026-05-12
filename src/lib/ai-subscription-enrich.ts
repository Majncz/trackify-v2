import type { PrismaClient } from "@prisma/client";
import {
  normalizeAiBillingCadence,
  type AiBillingCadenceValue,
} from "@/lib/ai-subscription-cadence";
import {
  allocateTimerMillisExclusiveEarliestStartsAt,
  buildAiPeriodMetrics,
  normalizeAiBillingKind,
  subscriptionUsageWindowEnd,
  billablePaidEarningsInWindow,
  type BillingCtx,
} from "@/lib/ai-subscription-metrics";
import { convertAmountToCurrency } from "@/lib/fx-rates";
import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";

const CZK = DEFAULT_BILLING_CURRENCY;

export type EnrichedAiPeriod = {
  id: string;
  userId: string;
  presetId: string | null;
  name: string;
  price: number;
  currency: string;
  startsAt: string;
  endsAt: string | null;
  depletedAt: string | null;
  billingKind: string;
  billingCadence: AiBillingCadenceValue;
  billingEmail: string | null;
  billingProviderUrl: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  priceApproxCzk: number | null;
  metrics: ReturnType<typeof buildAiPeriodMetrics>;
  paidEarningsByCurrency: Record<string, number>;
};

async function priceInCzk(
  price: number,
  currency: string
): Promise<number | null> {
  const cur = currency?.trim().toUpperCase().slice(0, 3) || CZK;
  if (cur === CZK) return price;
  const conv = await convertAmountToCurrency(price, cur, CZK);
  return conv?.amount ?? null;
}

export async function enrichAiSubscriptionPeriods(
  prisma: PrismaClient,
  userId: string,
  now = new Date()
): Promise<EnrichedAiPeriod[]> {
  const periods = await prisma.aiSubscriptionPeriod.findMany({
    where: { userId },
    orderBy: { startsAt: "desc" },
  });

  if (periods.length === 0) return [];

  const userTasks = await prisma.task.findMany({
    where: { userId },
    select: { id: true },
  });
  const taskIds = userTasks.map((t) => t.id);

  const events =
    taskIds.length === 0
      ? []
      : await prisma.event.findMany({
          where: { taskId: { in: taskIds } },
          select: {
            id: true,
            taskId: true,
            from: true,
            to: true,
            name: true,
            paymentRecordId: true,
            paidAmount: true,
          },
        });

  const billingRows = await prisma.billingTask.findMany({
    where: { userId },
    include: {
      task: {
        select: {
          id: true,
          name: true,
          taskGroup: { select: { id: true, name: true, color: true } },
        },
      },
    },
  });

  const billingByTaskId = new Map<string, BillingCtx>();
  for (const bt of billingRows) {
    billingByTaskId.set(bt.taskId, {
      taskId: bt.taskId,
      taskName: bt.task.name,
      taskGroup: bt.task.taskGroup,
      billing: {
        hourlyRate: bt.hourlyRate,
        roundingMins: bt.roundingMins,
        currency: bt.currency,
      },
    });
  }

  const billablePaidEvents = events.map((e) => ({
    from: e.from,
    to: e.to,
    taskId: e.taskId,
    paymentRecordId: e.paymentRecordId,
    name: e.name,
    paidAmount: e.paidAmount,
  }));

  const timelines = periods.map((p) => ({
    periodId: p.id,
    startsAt: p.startsAt,
    windowEnd: subscriptionUsageWindowEnd(p.endsAt, p.depletedAt, now),
  }));

  const overlapTimerCredit = allocateTimerMillisExclusiveEarliestStartsAt(
    events.map((e) => ({
      eventId: e.id,
      taskId: e.taskId,
      from: e.from,
      to: e.to,
    })),
    timelines
  );

  const out: EnrichedAiPeriod[] = [];

  for (const p of periods) {
    const windowEnd = subscriptionUsageWindowEnd(
      p.endsAt,
      p.depletedAt,
      now
    );
    const pCzk = await priceInCzk(p.price, p.currency);
    const billingKind = normalizeAiBillingKind(p.billingKind);
    const billingCadence = normalizeAiBillingCadence(p.billingCadence);

    const credit = overlapTimerCredit.get(p.id);
    const trackedMs = credit?.trackedMs ?? 0;
    const trackedHours = trackedMs / 3_600_000;

    const metrics = buildAiPeriodMetrics({
      startsAt: p.startsAt,
      windowEnd,
      trackedHours,
      tasksWithTrackedTime: credit?.taskIds.size ?? 0,
      eventsInWindow: credit?.eventIds.size ?? 0,
      now,
      calendarEndsAt: p.endsAt,
      depletedAt: p.depletedAt,
    });

    const paidEarningsByCurrency = billablePaidEarningsInWindow(
      billablePaidEvents,
      billingByTaskId,
      p.startsAt,
      windowEnd
    );

    // Round per-currency totals for display
    for (const cur of Object.keys(paidEarningsByCurrency)) {
      paidEarningsByCurrency[cur] =
        Math.round((paidEarningsByCurrency[cur] ?? 0) * 100) / 100;
    }

    out.push({
      id: p.id,
      userId: p.userId,
      presetId: p.presetId,
      name: p.name,
      price: p.price,
      currency: p.currency,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt?.toISOString() ?? null,
      depletedAt: p.depletedAt?.toISOString() ?? null,
      billingKind,
      billingCadence,
      billingEmail: p.billingEmail?.trim() || null,
      billingProviderUrl: p.billingProviderUrl?.trim() || null,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      priceApproxCzk: pCzk != null ? Math.round(pCzk * 100) / 100 : null,
      metrics,
      paidEarningsByCurrency,
    });
  }

  return out;
}
