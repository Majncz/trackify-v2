import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { eventToBillingSession } from "@/lib/billing";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const record = await prisma.paymentRecord.findFirst({
      where: { id, userId: user.id },
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

    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const billingTasks = await prisma.billingTask.findMany({
      where: { userId: user.id },
    });
    const billingByTaskId = new Map(billingTasks.map((b) => [b.taskId, b]));

    const sessions = [];
    for (const ev of record.events) {
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
        record.paidAt,
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

    return NextResponse.json({
      id: record.id,
      paidAt: record.paidAt.toISOString(),
      note: record.note,
      totalAmount: record.totalAmount,
      totalMinutes: record.totalMinutes,
      currency: record.currency,
      createdAt: record.createdAt.toISOString(),
      sessions,
    });
  } catch (error) {
    console.error("GET /api/billing/payments/[id]:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.paymentRecord.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.event.updateMany({
        where: { paymentRecordId: id },
        data: { paymentRecordId: null },
      }),
      prisma.paymentRecord.delete({ where: { id } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/billing/payments/[id]:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
