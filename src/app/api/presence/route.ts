import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { liveOverlapMs } from "@/lib/live-timer";
import { personName } from "@/lib/display-name";
import { endOfDay, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

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

  const [users, timers, events] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, displayName: true },
      orderBy: { email: "asc" },
    }),
    prisma.activeTimer.findMany({
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        task: { select: { name: true, hidden: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.event.findMany({
      where: {
        from: { lt: todayEnd },
        to: { gt: todayStart },
      },
      select: {
        from: true,
        to: true,
        task: { select: { userId: true } },
      },
    }),
  ]);

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

  const visibleTimers = timers.filter((timer) => !timer.task.hidden);
  const liveByUser = new Map(
    visibleTimers.map((timer) => [
      timer.user.id,
      {
        taskName: timer.task.name,
        startTime: timer.startTime.getTime(),
      },
    ])
  );

  const tracking = visibleTimers.map((timer) => ({
    userId: timer.user.id,
    name: personName(timer.user),
    taskName: timer.task.name,
    startTime: timer.startTime.getTime(),
    todayMs: todayByUser.get(timer.user.id) ?? 0,
  }));

  const leaderboard = users
    .map((row) => {
      const live = liveByUser.get(row.id);
      return {
        userId: row.id,
        name: personName(row),
        todayMs: todayByUser.get(row.id) ?? 0,
        startTime: live?.startTime ?? null,
        taskName: live?.taskName ?? null,
      };
    })
    .filter((row) => row.todayMs > 0 || row.startTime)
    .sort((a, b) => {
      const aLive = a.startTime ? Date.now() - a.startTime : 0;
      const bLive = b.startTime ? Date.now() - b.startTime : 0;
      return b.todayMs + bLive - (a.todayMs + aLive) || a.name.localeCompare(b.name);
    });

  return NextResponse.json({ tracking, leaderboard });
}
