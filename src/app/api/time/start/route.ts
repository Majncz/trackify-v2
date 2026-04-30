import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const startTimerSchema = z.object({
  taskId: z.string().uuid(),
  startedAt: z.string().datetime().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { taskId, startedAt } = startTimerSchema.parse(body);

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        userId: user.id,
        hidden: false,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const startTime = startedAt ? new Date(startedAt) : new Date();
    const existingTimer = await prisma.activeTimer.findUnique({
      where: { userId: user.id },
    });

    if (existingTimer) {
      return NextResponse.json({ error: "A timer is already running" }, { status: 409 });
    }

    const activeTimer = await prisma.activeTimer.create({
      data: {
        userId: user.id,
        taskId,
        startTime,
      },
    });

    return NextResponse.json({
      id: activeTimer.id,
      projectId: "desktop-workspace",
      taskId: activeTimer.taskId,
      startedAt: activeTimer.startTime.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    console.error("Start timer error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
