import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfDay, endOfDay } from "date-fns";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();

  // Get all tasks with their events
  const tasks = await prisma.task.findMany({
    where: {
      userId: session.user.id,
      hidden: false,
    },
    include: {
      events: true,
    },
  });

  const stats = tasks.map((task) => {
    const totalTime = task.events.reduce((sum, e) => sum + e.duration, 0);
    const todayTime = task.events
      .filter(
        (e) =>
          e.createdAt >= startOfDay(today) && e.createdAt <= endOfDay(today)
      )
      .reduce((sum, e) => sum + e.duration, 0);

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
