import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { liveOverlapMs } from "@/lib/live-timer";
import { personName } from "@/lib/display-name";
import { parseLeaderboardRange, periodWindowUtc } from "@/lib/period-window";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timezone = request.nextUrl.searchParams.get("timezone") || "UTC";
  const requestedDay = request.nextUrl.searchParams.get("day");
  const range = parseLeaderboardRange(request.nextUrl.searchParams.get("range"));
  const {
    start: periodStart,
    end: periodEnd,
    day,
    isCurrent,
    isToday,
  } = periodWindowUtc(timezone, range, requestedDay);

  const [users, timers, events] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, displayName: true },
      orderBy: { email: "asc" },
    }),
    isCurrent
      ? prisma.activeTimer.findMany({
          include: {
            user: { select: { id: true, email: true, displayName: true } },
            task: { select: { name: true, hidden: true } },
          },
          orderBy: { startTime: "asc" },
        })
      : Promise.resolve([]),
    prisma.event.findMany({
      where: {
        from: { lt: periodEnd },
        to: { gt: periodStart },
      },
      select: {
        from: true,
        to: true,
        task: { select: { userId: true } },
      },
    }),
  ]);

  const periodByUser = new Map<string, number>();
  for (const event of events) {
    const extra = liveOverlapMs(
      event.from.getTime(),
      event.to.getTime(),
      periodStart.getTime(),
      periodEnd.getTime()
    );
    const id = event.task.userId;
    periodByUser.set(id, (periodByUser.get(id) ?? 0) + extra);
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

  const now = Date.now();
  const liveWindowEnd = periodEnd.getTime() + 1;
  const tracking = visibleTimers.map((timer) => ({
    userId: timer.user.id,
    name: personName(timer.user),
    taskName: timer.task.name,
    startTime: timer.startTime.getTime(),
    todayMs: periodByUser.get(timer.user.id) ?? 0,
  }));

  const leaderboard = users
    .map((row) => {
      const live = isCurrent ? liveByUser.get(row.id) : undefined;
      return {
        userId: row.id,
        name: personName(row),
        todayMs: periodByUser.get(row.id) ?? 0,
        startTime: live?.startTime ?? null,
        taskName: live?.taskName ?? null,
      };
    })
    .filter((row) => row.todayMs > 0 || row.startTime)
    .sort((a, b) => {
      // Daily keeps the original live ranking (full open session).
      // Week/month add only the overlap with that window.
      const aLive = a.startTime
        ? range === "day"
          ? now - a.startTime
          : liveOverlapMs(a.startTime, now, periodStart.getTime(), liveWindowEnd)
        : 0;
      const bLive = b.startTime
        ? range === "day"
          ? now - b.startTime
          : liveOverlapMs(b.startTime, now, periodStart.getTime(), liveWindowEnd)
        : 0;
      return b.todayMs + bLive - (a.todayMs + aLive) || a.name.localeCompare(b.name);
    });

  return NextResponse.json({
    tracking,
    leaderboard,
    day,
    range,
    isToday,
    isCurrent,
  });
}
