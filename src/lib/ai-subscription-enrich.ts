import type { PrismaClient } from "@prisma/client";
import {
  buildAiPeriodMetrics,
  effectiveWindowEnd,
  hoursPer100Czk,
  medianHoursPer100Czk,
  trackedHoursForPeriod,
  billablePaidShareInWindow,
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
  note: string | null;
  createdAt: string;
  updatedAt: string;
  linkedTaskIds: string[];
  priceApproxCzk: number | null;
  metrics: ReturnType<typeof buildAiPeriodMetrics>;
  billablePaidShare: number | null;
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiTargetHoursPer100Czk: true },
  });

  const periods = await prisma.aiSubscriptionPeriod.findMany({
    where: { userId },
    include: {
      taskLinks: { select: { taskId: true } },
    },
    orderBy: { startsAt: "desc" },
  });

  if (periods.length === 0) return [];

  const allLinkedTaskIds = new Set<string>();
  for (const p of periods) {
    for (const l of p.taskLinks) allLinkedTaskIds.add(l.taskId);
  }

  const taskIds = Array.from(allLinkedTaskIds);
  const events =
    taskIds.length === 0
      ? []
      : await prisma.event.findMany({
          where: { taskId: { in: taskIds } },
          select: {
            taskId: true,
            from: true,
            to: true,
            name: true,
            paymentRecordId: true,
            paidAmount: true,
          },
        });

  const eventsByTask = new Map<string, typeof events>();
  for (const ev of events) {
    const list = eventsByTask.get(ev.taskId) ?? [];
    list.push(ev);
    eventsByTask.set(ev.taskId, list);
  }

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

  const historicalHp100: number[] = [];
  for (const p of periods) {
    const linked = p.taskLinks.map((l) => l.taskId);
    const taskSet = new Set(linked);
    const evs: { taskId: string; from: Date; to: Date }[] = [];
    for (const tid of linked) {
      for (const e of eventsByTask.get(tid) ?? []) {
        evs.push({
          taskId: e.taskId,
          from: e.from,
          to: e.to,
        });
      }
    }
    const windowEnd = effectiveWindowEnd(p.endsAt, now);
    const hours = trackedHoursForPeriod(evs, taskSet, p.startsAt, windowEnd);
    const pCzk = await priceInCzk(p.price, p.currency);
    const hp = hoursPer100Czk(hours, pCzk);
    if (
      p.endsAt &&
      p.endsAt.getTime() <= now.getTime() &&
      hp != null &&
      hp > 0
    ) {
      historicalHp100.push(hp);
    }
  }

  const medianHist = medianHoursPer100Czk(historicalHp100);

  const out: EnrichedAiPeriod[] = [];

  for (const p of periods) {
    const linkedTaskIds = p.taskLinks.map((l) => l.taskId);
    const evsFlat: { taskId: string; from: Date; to: Date }[] = [];
    const billableEvs: {
      from: Date;
      to: Date;
      taskId: string;
      paymentRecordId: string | null;
      name: string;
      paidAmount: number | null;
    }[] = [];

    for (const tid of linkedTaskIds) {
      for (const e of eventsByTask.get(tid) ?? []) {
        evsFlat.push({
          taskId: e.taskId,
          from: e.from,
          to: e.to,
        });
        billableEvs.push({
          from: e.from,
          to: e.to,
          taskId: e.taskId,
          paymentRecordId: e.paymentRecordId,
          name: e.name,
          paidAmount: e.paidAmount,
        });
      }
    }

    const windowEnd = effectiveWindowEnd(p.endsAt, now);
    const pCzk = await priceInCzk(p.price, p.currency);

    const metrics = buildAiPeriodMetrics({
      price: p.price,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      now,
      linkedTaskIds,
      events: evsFlat,
      priceInCzk: pCzk,
      userTargetHoursPer100Czk: user?.aiTargetHoursPer100Czk ?? null,
      medianHoursPer100Czk: medianHist,
    });

    const billCtx = new Map<string, BillingCtx>();
    for (const tid of linkedTaskIds) {
      const b = billingByTaskId.get(tid);
      if (b) billCtx.set(tid, b);
    }

    const paidShare = billablePaidShareInWindow(
      billableEvs.filter((e) => billCtx.has(e.taskId)),
      billCtx,
      p.startsAt,
      windowEnd
    );

    out.push({
      id: p.id,
      userId: p.userId,
      presetId: p.presetId,
      name: p.name,
      price: p.price,
      currency: p.currency,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt?.toISOString() ?? null,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      linkedTaskIds,
      priceApproxCzk: pCzk != null ? Math.round(pCzk * 100) / 100 : null,
      metrics,
      billablePaidShare: paidShare.ratio,
    });
  }

  return out;
}
