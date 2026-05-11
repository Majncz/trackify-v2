import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { eventToBillingSession, type BillingSessionRow } from "@/lib/billing";

const groupByEnum = z.enum(["day", "week", "month"]);

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
    const { searchParams } = new URL(request.url);
    const fromRaw = searchParams.get("from");
    const toRaw = searchParams.get("to");
    const taskIdFilter = searchParams.get("taskId");
    const taskGroupRaw = searchParams.get("taskGroupId");
    const statusRaw = searchParams.get("status") ?? "all";
    const groupByRaw = searchParams.get("groupBy") ?? "day";
    const groupByParsed = groupByEnum.safeParse(groupByRaw);
    const groupBy = groupByParsed.success ? groupByParsed.data : "day";

    const statusParse = z.enum(["unpaid", "paid", "all"]).safeParse(statusRaw);
    const status = statusParse.success ? statusParse.data : "all";

    const billingTaskWhere: Prisma.BillingTaskWhereInput = { userId: user.id };
    if (taskGroupRaw === "ungrouped") {
      billingTaskWhere.task = { taskGroupId: null };
    } else if (taskGroupRaw) {
      const gParse = z.string().uuid().safeParse(taskGroupRaw);
      if (!gParse.success) {
        return NextResponse.json(
          { error: "Invalid taskGroupId" },
          { status: 400 }
        );
      }
      billingTaskWhere.task = { taskGroupId: gParse.data };
    }

    const taskGroupSelect = {
      id: true,
      name: true,
      color: true,
    } as const;

    const billingTasks = await prisma.billingTask.findMany({
      where: billingTaskWhere,
      include: {
        task: {
          select: {
            id: true,
            name: true,
            taskGroup: { select: taskGroupSelect },
          },
        },
      },
    });

    if (billingTasks.length === 0) {
      return NextResponse.json({
        sessions: [] as BillingSessionRow[],
        groupBy,
      });
    }

    let taskIds = billingTasks.map((b) => b.taskId);
    if (taskIdFilter) {
      if (!taskIds.includes(taskIdFilter)) {
        return NextResponse.json(
          { error: "Task is not enrolled in billing" },
          { status: 400 }
        );
      }
      taskIds = [taskIdFilter];
    }

    const billingByTaskId = new Map(
      billingTasks.map((bt) => [bt.taskId, bt])
    );

    const where: Prisma.EventWhereInput = {
      taskId: { in: taskIds },
    };

    const fromFilter: Prisma.DateTimeFilter = {};
    if (fromRaw) {
      const fromDate = new Date(fromRaw);
      if (Number.isNaN(fromDate.getTime())) {
        return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
      }
      fromFilter.gte = fromDate;
    }
    if (toRaw) {
      const toDate = new Date(toRaw);
      if (Number.isNaN(toDate.getTime())) {
        return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
      }
      fromFilter.lte = toDate;
    }
    if (Object.keys(fromFilter).length > 0) {
      where.from = fromFilter;
    }

    if (status === "unpaid") {
      where.paymentRecordId = null;
    } else if (status === "paid") {
      where.paymentRecordId = { not: null };
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        paymentRecord: { select: { paidAt: true } },
      },
      orderBy: { from: "desc" },
    });

    const sessions: BillingSessionRow[] = [];

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
          paidAmount: ev.paidAmount,
        },
        bt.task.name,
        {
          hourlyRate: bt.hourlyRate,
          roundingMins: bt.roundingMins,
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
      sessions.push(row);
    }

    return NextResponse.json({ sessions, groupBy });
  } catch (error) {
    console.error("GET /api/billing/sessions:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
