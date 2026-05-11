import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enrichAiSubscriptionPeriods } from "@/lib/ai-subscription-enrich";
import { buildRatesToViewCurrency } from "@/lib/fx-rates";
import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";
import {
  endOfMonth,
  format,
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

    const inRange = (startsAt: string, endsAt: string | null) => {
      if (!rangeFrom || !rangeTo) return true;
      const s = parseISO(startsAt);
      const e = endsAt ? parseISO(endsAt) : now;
      try {
        return (
          isWithinInterval(s, { start: rangeFrom, end: rangeTo }) ||
          isWithinInterval(e, { start: rangeFrom, end: rangeTo }) ||
          (s <= rangeFrom && e >= rangeTo)
        );
      } catch {
        return true;
      }
    };

    const filtered = periods.filter((p) => inRange(p.startsAt, p.endsAt));

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
      if (mult > 0) {
        lifetimeInView += p.price * mult;
      }

      const s = parseISO(p.startsAt);
      const e = p.endsAt ? parseISO(p.endsAt) : now;
      if (mult > 0 && s <= monthEnd && e >= monthStart) {
        monthOverlapInView += p.price * mult;
      }

      if (mult > 0) {
        const key = format(s, "yyyy-MM");
        monthTotals.set(key, (monthTotals.get(key) ?? 0) + p.price * mult);
      }
    }

    const sortedMonths = Array.from(monthTotals.keys()).sort();
    let run = 0;
    for (const m of sortedMonths) {
      run += monthTotals.get(m) ?? 0;
      cumulativeByMonth.push({ month: m, totalInView: Math.round(run * 100) / 100 });
    }

    const activeCount = periods.filter((p) => p.metrics.isActive).length;

    const rankedByHours = [...filtered]
      .filter((p) => p.metrics.trackedHours > 0)
      .sort((a, b) => b.metrics.trackedHours - a.metrics.trackedHours);
    const rankedByCostHour = [...filtered]
      .filter((p) => p.metrics.costPerHour != null)
      .sort((a, b) => (a.metrics.costPerHour ?? 0) - (b.metrics.costPerHour ?? 0));

    const correlationPoints = filtered
      .filter((p) => p.billablePaidShare != null)
      .map((p) => ({
        id: p.id,
        name: p.name,
        durationDays: p.metrics.durationDays,
        billablePaidShare: p.billablePaidShare,
      }));

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
      rankings: {
        mostTrackedHours: rankedByHours.slice(0, 8).map((p) => ({
          id: p.id,
          name: p.name,
          trackedHours: p.metrics.trackedHours,
        })),
        lowestCostPerHour: rankedByCostHour.slice(0, 8).map((p) => ({
          id: p.id,
          name: p.name,
          costPerHour: p.metrics.costPerHour,
          currency: p.currency,
        })),
      },
      correlation: correlationPoints,
      periods: filtered,
    });
  } catch (error) {
    console.error("GET /api/ai-subscriptions/analytics:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
