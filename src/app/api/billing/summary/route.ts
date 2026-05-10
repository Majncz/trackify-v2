import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  billingUtcIsoWeekKey,
  billingUtcMonthKey,
  eventToBillingSession,
} from "@/lib/billing";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

type CurrencyBlock = {
  unpaidTotal: number;
  thisWeekTotal: number;
  thisMonthTotal: number;
  allTimeTotal: number;
  allTimePaidTotal: number;
};

function emptyBlock(): CurrencyBlock {
  return {
    unpaidTotal: 0,
    thisWeekTotal: 0,
    thisMonthTotal: 0,
    allTimeTotal: 0,
    allTimePaidTotal: 0,
  };
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const billingTasks = await prisma.billingTask.findMany({
      where: { userId: user.id },
      include: {
        task: {
          select: {
            name: true,
            taskGroup: {
              select: { id: true, name: true, color: true },
            },
          },
        },
      },
    });

    if (billingTasks.length === 0) {
      return NextResponse.json({
        byCurrency: {} as Record<string, CurrencyBlock>,
      });
    }

    const taskIds = billingTasks.map((b) => b.taskId);
    const billingByTaskId = new Map(
      billingTasks.map((bt) => [bt.taskId, bt])
    );

    const events = await prisma.event.findMany({
      where: { taskId: { in: taskIds } },
      include: { paymentRecord: { select: { paidAt: true } } },
    });

    const now = new Date();
    const thisMonthKey = billingUtcMonthKey(now);
    const thisWeekKey = billingUtcIsoWeekKey(now);

    const byCurrency: Record<string, CurrencyBlock> = {};

    const ensure = (c: string): CurrencyBlock => {
      if (!byCurrency[c]) byCurrency[c] = emptyBlock();
      return byCurrency[c];
    };

    for (const ev of events) {
      const bt = billingByTaskId.get(ev.taskId);
      if (!bt) continue;

      const row = eventToBillingSession(
        {
          id: ev.id,
          from: ev.from,
          to: ev.to,
          name: ev.name,
          taskId: ev.taskId,
          paymentRecordId: ev.paymentRecordId,
        },
        bt.task.name,
        {
          hourlyRate: bt.hourlyRate,
          roundingMins: bt.roundingMins,
          minSessionMins: bt.minSessionMins,
          currency: bt.currency,
        },
        ev.paymentRecord?.paidAt ?? null,
        bt.task.taskGroup
          ? {
              id: bt.task.taskGroup.id,
              name: bt.task.taskGroup.name,
              color: bt.task.taskGroup.color,
            }
          : null
      );

      if (!row) continue;

      const block = ensure(row.currency);
      block.allTimeTotal += row.earnings;

      if (row.isPaid) {
        block.allTimePaidTotal += row.earnings;
      } else {
        block.unpaidTotal += row.earnings;
      }

      if (row.groupMonth === thisMonthKey) {
        block.thisMonthTotal += row.earnings;
      }
      if (row.groupWeek === thisWeekKey) {
        block.thisWeekTotal += row.earnings;
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    for (const c of Object.keys(byCurrency)) {
      const b = byCurrency[c];
      b.unpaidTotal = round2(b.unpaidTotal);
      b.thisWeekTotal = round2(b.thisWeekTotal);
      b.thisMonthTotal = round2(b.thisMonthTotal);
      b.allTimeTotal = round2(b.allTimeTotal);
      b.allTimePaidTotal = round2(b.allTimePaidTotal);
    }

    return NextResponse.json({ byCurrency });
  } catch (error) {
    console.error("GET /api/billing/summary:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
