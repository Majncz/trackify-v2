import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const user = await getAuthUser(request);
  const { entryId } = await params;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeTimer = await prisma.activeTimer.findUnique({
    where: { userId: user.id },
    include: {
      task: {
        select: { hidden: true },
      },
    },
  });

  if (!activeTimer || activeTimer.task.hidden) {
    return NextResponse.json({ error: "No active timer found" }, { status: 404 });
  }

  if (activeTimer.id !== entryId) {
    return NextResponse.json({ error: "Timer has changed. Refresh and try again." }, { status: 409 });
  }

  const stoppedAt = new Date();
  const event = await prisma.event.create({
    data: {
      taskId: activeTimer.taskId,
      name: "Time entry",
      from: activeTimer.startTime,
      to: stoppedAt,
    },
  });

  await prisma.activeTimer.delete({
    where: { userId: user.id },
  });

  return NextResponse.json({
    id: activeTimer.id,
    projectId: "desktop-workspace",
    taskId: activeTimer.taskId,
    startedAt: activeTimer.startTime.toISOString(),
    stoppedAt: event.to.toISOString(),
    durationSeconds: Math.max(0, Math.floor((event.to.getTime() - event.from.getTime()) / 1000)),
  });
}
