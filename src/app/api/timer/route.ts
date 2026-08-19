import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { validateNoOverlap, OverlapError } from "@/lib/event-overlap";
import {
  emitToUser,
  persistTimerStart,
  persistTimerStartTime,
  persistTimerStop,
} from "@/lib/timer-runtime";
import { z } from "zod";

const startSchema = z.object({
  taskId: z.string().uuid(),
  startTime: z.string().datetime().optional(),
});

const updateSchema = z.object({
  taskId: z.string().uuid(),
  newStartTime: z.string().datetime(),
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timer = await prisma.activeTimer.findUnique({
    where: { userId: user.id },
    include: { task: { select: { hidden: true } } },
  });

  if (!timer || timer.task.hidden) {
    return NextResponse.json({ running: false });
  }

  return NextResponse.json({
    running: true,
    taskId: timer.taskId,
    startTime: timer.startTime.getTime(),
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { taskId, startTime: startTimeRaw } = startSchema.parse(body);
    const now = Date.now();
    let startTime = startTimeRaw ? new Date(startTimeRaw).getTime() : now;
    if (Number.isNaN(startTime) || startTime > now + 5000) {
      startTime = now;
    }
    if (startTime < now - 40 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Start time is too old" }, { status: 400 });
    }

    await persistTimerStart(user.id, taskId, startTime);
    emitToUser(user.id, "timer:started", { taskId, startTime });

    return NextResponse.json({ running: true, taskId, startTime });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Task not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Start timer error:", error);
    return NextResponse.json({ error: "Failed to start timer" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { taskId, newStartTime: newStartRaw } = updateSchema.parse(body);
    const newStartTime = new Date(newStartRaw).getTime();
    const now = Date.now();

    if (newStartTime > now) {
      return NextResponse.json(
        { error: "Start time cannot be in the future" },
        { status: 400 }
      );
    }
    if (newStartTime < now - 40 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Start time is too old" }, { status: 400 });
    }

    await validateNoOverlap({
      userId: user.id,
      eventFrom: new Date(newStartTime),
      eventTo: new Date(now),
      skipRunningTimerCheck: true,
    });

    await persistTimerStartTime(user.id, taskId, newStartTime);
    emitToUser(user.id, "timer:start-updated", { taskId, startTime: newStartTime });

    return NextResponse.json({ running: true, taskId, startTime: newStartTime });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    if (error instanceof OverlapError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Update timer start error:", error);
    return NextResponse.json({ error: "Failed to update start time" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const taskId = request.nextUrl.searchParams.get("taskId") ?? undefined;
    const timer = await prisma.activeTimer.findUnique({
      where: { userId: user.id },
    });
    const stopped = await persistTimerStop(user.id, taskId);
    if (stopped && timer && (!taskId || timer.taskId === taskId)) {
      emitToUser(user.id, "timer:stopped", {
        taskId: timer.taskId,
        duration: Math.max(0, Date.now() - timer.startTime.getTime()),
      });
    }
    return NextResponse.json({ running: !stopped && Boolean(timer) });
  } catch (error) {
    console.error("Stop timer error:", error);
    return NextResponse.json({ error: "Failed to stop timer" }, { status: 500 });
  }
}
