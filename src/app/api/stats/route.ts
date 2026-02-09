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

  // Get timezone from query param, default to UTC
  const { searchParams } = new URL(request.url);
  const timezone = searchParams.get("timezone") || "UTC";

  // Get current time in user's timezone, then find start/end of day
  const now = new Date();
  const nowInUserTz = toZonedTime(now, timezone);
  const todayStartInUserTz = startOfDay(nowInUserTz);
  const todayEndInUserTz = endOfDay(nowInUserTz);
  
  // Convert back to UTC for database comparison
  const todayStartUtc = fromZonedTime(todayStartInUserTz, timezone);
  const todayEndUtc = fromZonedTime(todayEndInUserTz, timezone);

  // Get all tasks with their events
  const tasks = await prisma.task.findMany({
    where: {
      userId: user.id,
      hidden: false,
    },
    include: {
      events: true,
    },
  });

  const stats = tasks.map((task) => {
    const totalTime = task.events.reduce((sum, e) => sum + (e.to.getTime() - e.from.getTime()), 0);
    
    // Calculate today's time by checking overlap with today's window
    const todayTime = task.events.reduce((sum, e) => {
      // Check if event overlaps with today
      if (e.to <= todayStartUtc || e.from >= todayEndUtc) {
        // No overlap
        return sum;
      }
      
      // Calculate the overlapping portion
      const overlapStart = Math.max(e.from.getTime(), todayStartUtc.getTime());
      const overlapEnd = Math.min(e.to.getTime(), todayEndUtc.getTime());
      const overlapDuration = overlapEnd - overlapStart;
      
      return sum + Math.max(0, overlapDuration);
    }, 0);

    return {
      taskId: task.id,
      taskName: task.name,
      totalTime,
      todayTime,
    };
  });

  const grandTotal = stats.reduce((sum, s) => sum + s.totalTime, 0);
  const todayTotal = stats.reduce((sum, s) => sum + s.todayTime, 0);

  return NextResponse.json({
    tasks: stats,
    grandTotal,
    todayTotal,
  });
}
