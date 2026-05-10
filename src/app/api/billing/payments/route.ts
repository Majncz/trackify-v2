import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { eventToBillingSession } from "@/lib/billing";

const createPaymentSchema = z.object({
  eventIds: z.array(z.string().uuid()).min(1),
  paidAt: z.string().datetime(),
  note: z.string().max(2000).optional(),
});

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const records = await prisma.paymentRecord.findMany({
      where: { userId: user.id },
      orderBy: { paidAt: "desc" },
      include: {
        events: {
          orderBy: { from: "desc" },
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
        },
      },
    });

    const billingTasks = await prisma.billingTask.findMany({
      where: { userId: user.id },
    });
    const billingByTaskId = new Map(billingTasks.map((b) => [b.taskId, b]));

    return NextResponse.json(
      records.map((r) => {
        const sessions = [];
        for (const ev of r.events) {
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
            ev.task.name,
            {
              hourlyRate: bt.hourlyRate,
              roundingMins: bt.roundingMins,
              minSessionMins: bt.minSessionMins,
              currency: bt.currency,
            },
            r.paidAt,
            ev.task.taskGroup
              ? {
                  id: ev.task.taskGroup.id,
                  name: ev.task.taskGroup.name,
                  color: ev.task.taskGroup.color,
                }
              : null
          );
          if (row) sessions.push(row);
        }

        return {
          id: r.id,
          paidAt: r.paidAt.toISOString(),
          note: r.note,
          totalAmount: r.totalAmount,
          totalMinutes: r.totalMinutes,
          currency: r.currency,
          createdAt: r.createdAt.toISOString(),
          sessions,
        };
      })
    );
  } catch (error) {
    console.error("GET /api/billing/payments:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createPaymentSchema.parse(body);
    const paidAtDate = new Date(parsed.paidAt);

    if (Number.isNaN(paidAtDate.getTime())) {
      return NextResponse.json({ error: "Invalid paidAt" }, { status: 400 });
    }

    const billingTasks = await prisma.billingTask.findMany({
      where: { userId: user.id },
    });
    const enrolledIds = new Set(billingTasks.map((b) => b.taskId));
    const billingByTaskId = new Map(billingTasks.map((b) => [b.taskId, b]));

    const uniqueIds = Array.from(new Set(parsed.eventIds));
    if (uniqueIds.length !== parsed.eventIds.length) {
      return NextResponse.json(
        { error: "Duplicate event ids in request" },
        { status: 400 }
      );
    }

    const events = await prisma.event.findMany({
      where: {
        id: { in: uniqueIds },
        paymentRecordId: null,
      },
      include: {
        paymentRecord: { select: { paidAt: true } },
      },
    });

    if (events.length !== uniqueIds.length) {
      return NextResponse.json(
        {
          error:
            "Some events were not found, are already paid, or are duplicated",
        },
        { status: 400 }
      );
    }

    let totalAmount = 0;
    let totalMinutes = 0;
    let paymentCurrency: string | null = null;

    for (const ev of events) {
      if (!enrolledIds.has(ev.taskId)) {
        return NextResponse.json(
          { error: "Some events belong to tasks not enrolled in billing" },
          { status: 400 }
        );
      }
      const bt = billingByTaskId.get(ev.taskId)!;
      if (paymentCurrency === null) {
        paymentCurrency = bt.currency;
      } else if (paymentCurrency !== bt.currency) {
        return NextResponse.json(
          { error: "All sessions in one payment must use the same currency" },
          { status: 400 }
        );
      }
      const row = eventToBillingSession(
        {
          id: ev.id,
          from: ev.from,
          to: ev.to,
          name: ev.name,
          taskId: ev.taskId,
          paymentRecordId: ev.paymentRecordId,
        },
        "",
        {
          hourlyRate: bt.hourlyRate,
          roundingMins: bt.roundingMins,
          minSessionMins: bt.minSessionMins,
          currency: bt.currency,
        },
        ev.paymentRecord?.paidAt ?? null
      );
      if (!row) {
        return NextResponse.json(
          { error: "Some events are below the minimum billable session length" },
          { status: 400 }
        );
      }
      totalAmount += row.earnings;
      totalMinutes += row.durationMinutes;
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentRecord.create({
        data: {
          userId: user.id,
          paidAt: paidAtDate,
          note: parsed.note ?? null,
          totalAmount,
          totalMinutes,
          currency: paymentCurrency ?? "CZK",
        },
      });

      await tx.event.updateMany({
        where: { id: { in: uniqueIds } },
        data: { paymentRecordId: created.id },
      });

      return created;
    });

    return NextResponse.json({
      id: record.id,
      paidAt: record.paidAt.toISOString(),
      note: record.note,
      totalAmount: record.totalAmount,
      totalMinutes: record.totalMinutes,
      currency: record.currency,
      eventCount: uniqueIds.length,
      createdAt: record.createdAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    console.error("POST /api/billing/payments:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
