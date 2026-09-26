import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { personName } from "@/lib/display-name";
import { customRangeUtc } from "@/lib/period-window";
import { colorForId, mergeIntervals } from "@/lib/bar-race";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timezone = request.nextUrl.searchParams.get("timezone") || "UTC";
  const { start, end, from, to } = customRangeUtc(
    timezone,
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to")
  );

  const now = Date.now();
  const rangeEnd = Math.min(end.getTime(), now);
  const rangeStart = start.getTime();
  if (rangeEnd <= rangeStart) {
    return NextResponse.json({
      from,
      to,
      rangeStart,
      rangeEnd,
      users: [],
      events: [],
    });
  }

  const includeLive = now >= rangeStart && now <= end.getTime();

  const [users, events, timers] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, displayName: true },
      orderBy: { email: "asc" },
    }),
    prisma.event.findMany({
      where: {
        from: { lt: new Date(rangeEnd) },
        to: { gt: start },
      },
      select: {
        from: true,
        to: true,
        task: { select: { userId: true, hidden: true } },
      },
    }),
    includeLive
      ? prisma.activeTimer.findMany({
          include: { task: { select: { userId: true, hidden: true } } },
        })
      : Promise.resolve([]),
  ]);

  const clipped: { userId: string; from: number; to: number }[] = [];
  for (const event of events) {
    if (event.task.hidden) continue;
    const fromMs = Math.max(event.from.getTime(), rangeStart);
    const toMs = Math.min(event.to.getTime(), rangeEnd);
    if (toMs > fromMs) {
      clipped.push({ userId: event.task.userId, from: fromMs, to: toMs });
    }
  }

  for (const timer of timers) {
    if (timer.task.hidden) continue;
    const fromMs = Math.max(timer.startTime.getTime(), rangeStart);
    const toMs = rangeEnd;
    if (toMs > fromMs) {
      clipped.push({ userId: timer.userId, from: fromMs, to: toMs });
    }
  }

  const merged = mergeIntervals(clipped);
  const present = new Set(merged.map((event) => event.userId));

  return NextResponse.json({
    from,
    to,
    rangeStart,
    rangeEnd,
    users: users
      .filter((row) => present.has(row.id))
      .map((row) => ({
        id: row.id,
        name: personName(row),
        color: colorForId(row.id),
      })),
    events: merged,
  });
}
