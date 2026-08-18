import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { liveOverlapMs } from "@/lib/live-timer";
import { endOfDay, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function todayWindowUtc(timezone: string) {
  const now = new Date();
  const nowInTz = toZonedTime(now, timezone);
  return {
    start: fromZonedTime(startOfDay(nowInTz), timezone),
    end: fromZonedTime(endOfDay(nowInTz), timezone),
  };
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timezone = request.nextUrl.searchParams.get("timezone") || "UTC";
  const { start: todayStart, end: todayEnd } = todayWindowUtc(timezone);
  const timers = await prisma.activeTimer.findMany({
    include: {
      user: { select: { id: true, email: true, displayName: true } },
      task: { select: { name: true, hidden: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const visible = timers.filter((timer) => !timer.task.hidden);
  const userIds = visible.map((timer) => timer.user.id);

  const events =
    userIds.length === 0
      ? []
      : await prisma.event.findMany({
          where: {
            task: { userId: { in: userIds } },
            from: { lt: todayEnd },
            to: { gt: todayStart },
          },
          select: {
            from: true,
            to: true,
            task: { select: { userId: true } },
          },
        });

  const todayByUser = new Map<string, number>();
  for (const event of events) {
    const extra = liveOverlapMs(
      event.from.getTime(),
      event.to.getTime(),
      todayStart.getTime(),
      todayEnd.getTime()
    );
    const id = event.task.userId;
    todayByUser.set(id, (todayByUser.get(id) ?? 0) + extra);
  }

  const tracking = visible.map((timer) => ({
    userId: timer.user.id,
    name: timer.user.displayName?.trim() || displayNameFromEmail(timer.user.email),
    taskName: timer.task.name,
    startTime: timer.startTime.getTime(),
    todayMs: todayByUser.get(timer.user.id) ?? 0,
  }));

  return NextResponse.json({ tracking });
}
