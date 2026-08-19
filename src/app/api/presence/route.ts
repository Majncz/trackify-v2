import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { liveOverlapMs } from "@/lib/live-timer";
import { personName } from "@/lib/display-name";
import { endOfDay, format, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

function dayWindowUtc(timezone: string, dayKey: string | null) {
  const nowInTz = toZonedTime(new Date(), timezone);
  const todayKey = format(startOfDay(nowInTz), "yyyy-MM-dd");
  const key = dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey) && dayKey <= todayKey ? dayKey : todayKey;
  const [year, month, day] = key.split("-").map(Number);
  const wall = startOfDay(nowInTz);
  wall.setFullYear(year, month - 1, day);
  wall.setHours(0, 0, 0, 0);
  return {
    start: fromZonedTime(startOfDay(wall), timezone),
    end: fromZonedTime(endOfDay(wall), timezone),
    day: key,
    isToday: key === todayKey,
  };
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timezone = request.nextUrl.searchParams.get("timezone") || "UTC";
  const requestedDay = request.nextUrl.searchParams.get("day");
  const { start: dayStart, end: dayEnd, day, isToday } = dayWindowUtc(timezone, requestedDay);

  const [users, timers, events] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, displayName: true },
      orderBy: { email: "asc" },
    }),
    isToday
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
        from: { lt: dayEnd },
        to: { gt: dayStart },
      },
      select: {
        from: true,
        to: true,
        task: { select: { userId: true } },
      },
    }),
  ]);

  const dayByUser = new Map<string, number>();
  for (const event of events) {
    const extra = liveOverlapMs(
      event.from.getTime(),
      event.to.getTime(),
      dayStart.getTime(),
      dayEnd.getTime()
    );
    const id = event.task.userId;
    dayByUser.set(id, (dayByUser.get(id) ?? 0) + extra);
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
    todayMs: dayByUser.get(timer.user.id) ?? 0,
  }));

  const leaderboard = users
    .map((row) => {
      const live = isToday ? liveByUser.get(row.id) : undefined;
      return {
        userId: row.id,
        name: personName(row),
        todayMs: dayByUser.get(row.id) ?? 0,
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

  return NextResponse.json({ tracking, leaderboard, day, isToday });
}
