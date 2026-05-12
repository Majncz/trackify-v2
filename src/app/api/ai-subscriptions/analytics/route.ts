import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enrichAiSubscriptionPeriods } from "@/lib/ai-subscription-enrich";
import {
  accumulateAiBillingIntoMonthTotals,
  aiBillingSpendNativeTotal,
  normalizeAiBillingKind,
  subscriptionUsageWindowEnd,
} from "@/lib/ai-subscription-metrics";
import { buildRatesToViewCurrency } from "@/lib/fx-rates";
import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";
import { prismaKnownRequestUserMessage } from "@/lib/prisma-client-errors";
import {
  endOfMonth,
  isWithinInterval,
  parseISO,
  startOfMonth,
} from "date-fns";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const viewCurrencyRaw = searchParams.get("viewCurrency");
  const viewCurrency =
    viewCurrencyRaw?.trim().toUpperCase().slice(0, 3) ||
    DEFAULT_BILLING_CURRENCY;

  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  let rangeFrom: Date | null = null;
  let rangeTo: Date | null = null;
  if (fromRaw && toRaw) {
    try {
      rangeFrom = parseISO(fromRaw);
      rangeTo = parseISO(toRaw);
      if (
        Number.isNaN(rangeFrom.getTime()) ||
        Number.isNaN(rangeTo.getTime())
      ) {
        rangeFrom = null;
        rangeTo = null;
      }
    } catch {
      rangeFrom = null;
      rangeTo = null;
    }
  }

  try {
    const now = new Date();
    const periods = await enrichAiSubscriptionPeriods(prisma, user.id, now);

    const filtered = periods.filter((p) => {
      if (!rangeFrom || !rangeTo) return true;
      const s = parseISO(p.startsAt);
      const e = subscriptionUsageWindowEnd(
        p.endsAt ? parseISO(p.endsAt) : null,
        p.depletedAt ? parseISO(p.depletedAt) : null,
        now
      );
      try {
        return (
          isWithinInterval(s, { start: rangeFrom, end: rangeTo }) ||
          isWithinInterval(e, { start: rangeFrom, end: rangeTo }) ||
          (s <= rangeFrom && e >= rangeTo)
        );
      } catch {
        return true;
      }
    });

    const currencies = Array.from(new Set(periods.map((p) => p.currency)));
    const { toView, missing } = await buildRatesToViewCurrency(
      viewCurrency,
      currencies
    );

    let lifetimeInView = 0;
    let monthOverlapInView = 0;
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const cumulativeByMonth: { month: string; totalInView: number }[] = [];
    const monthTotals = new Map<string, number>();

    for (const p of periods) {
      const mult = toView[p.currency] ?? (p.currency === viewCurrency ? 1 : 0);
      const s = parseISO(p.startsAt);
      const calendarEnd = p.endsAt ? parseISO(p.endsAt) : null;
      const depleted = p.depletedAt ? parseISO(p.depletedAt) : null;
      const spanEnd = subscriptionUsageWindowEnd(calendarEnd, depleted, now);
      const kind = normalizeAiBillingKind(p.billingKind);

      if (mult <= 0) continue;

      lifetimeInView +=
        aiBillingSpendNativeTotal({
          startsAt: s,
          calendarEndsAt: calendarEnd,
          depletedAt: depleted,
          now,
          unitPrice: p.price,
          billingKind: kind,
        }) * mult;

      if (s <= monthEnd && spanEnd >= monthStart) {
        monthOverlapInView += p.price * mult;
      }

      accumulateAiBillingIntoMonthTotals({
        monthTotals,
        startsAt: s,
        calendarEndsAt: calendarEnd,
        depletedAt: depleted,
        now,
        unitPrice: p.price,
        billingKind: kind,
        mult,
      });
    }

    const sortedMonths = Array.from(monthTotals.keys()).sort();
    let run = 0;
    const spendByMonth: { month: string; totalInView: number }[] = [];
    for (const m of sortedMonths) {
      const monthly = monthTotals.get(m) ?? 0;
      spendByMonth.push({ month: m, totalInView: Math.round(monthly * 100) / 100 });
      run += monthly;
      cumulativeByMonth.push({ month: m, totalInView: Math.round(run * 100) / 100 });
    }

    const activeCount = periods.filter((p) => p.metrics.isActive).length;

    const rankedByHours = [...filtered]
      .filter((p) => p.metrics.trackedHours > 0)
      .sort((a, b) => b.metrics.trackedHours - a.metrics.trackedHours);

    return NextResponse.json({
      viewCurrency,
      fxMissingCurrencies: missing,
      summary: {
        lifetimeSpendInView: Math.round(lifetimeInView * 100) / 100,
        currentMonthOverlapSpendInView:
          Math.round(monthOverlapInView * 100) / 100,
        activeSubscriptions: activeCount,
        periodCount: periods.length,
      },
      cumulativeByMonth,
      spendByMonth,
      rankings: {
        mostTrackedHours: rankedByHours.slice(0, 8).map((p) => ({
          id: p.id,
          name: p.name,
          trackedHours: p.metrics.trackedHours,
        })),
      },
      periods: filtered,
    });
  } catch (error) {
    console.error("GET /api/ai-subscriptions/analytics:", error);
    const prismaMsg = prismaKnownRequestUserMessage(error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      {
        error: prismaMsg ?? "Internal server error",
        ...(detail ? { detail } : {}),
      },
      { status: prismaMsg ? 503 : 500 }
    );
  }
}
