import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { startOfDay, endOfDay } from "date-fns";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const timezone = searchParams.get("timezone") || "UTC";

  const now = new Date();
  const nowInUserTz = toZonedTime(now, timezone);
  const todayStartInUserTz = startOfDay(nowInUserTz);
  const todayEndInUserTz = endOfDay(nowInUserTz);
  const todayStartUtc = fromZonedTime(todayStartInUserTz, timezone);
  const todayEndUtc = fromZonedTime(todayEndInUserTz, timezone);

  const [activeTimer, tasks] = await Promise.all([
    prisma.activeTimer.findUnique({
      where: { userId: user.id },
      include: { task: { select: { hidden: true } } },
    }),
    prisma.task.findMany({
      where: { userId: user.id, hidden: false },
      include: { events: true },
    }),
  ]);

  const todayTotalSeconds = Math.floor(
    tasks.reduce((sum, task) => {
      return (
        sum +
        task.events.reduce((eventSum, event) => {
          if (event.to <= todayStartUtc || event.from >= todayEndUtc) return eventSum;
          const overlapStart = Math.max(event.from.getTime(), todayStartUtc.getTime());
          const overlapEnd = Math.min(event.to.getTime(), todayEndUtc.getTime());
          return eventSum + Math.max(0, overlapEnd - overlapStart);
        }, 0)
      );
    }, 0) / 1000,
  );

  if (activeTimer && !activeTimer.task.hidden) {
    return NextResponse.json({
      status: "running",
      queuedActions: 0,
      todayTotalSeconds,
      entry: {
        id: activeTimer.id,
        projectId: "desktop-workspace",
        taskId: activeTimer.taskId,
        startedAt: activeTimer.startTime.toISOString(),
      },
    });
  }

  return NextResponse.json({
    status: "idle",
    queuedActions: 0,
    todayTotalSeconds,
  });
}
