import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { emitToUser, persistTimerStop } from "@/lib/timer-runtime";

const updateTaskSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  hidden: z.boolean().optional(),
});

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id } = await params;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const task = await prisma.task.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        events: {
          orderBy: { from: "desc" },
        },
        taskGroup: { select: { id: true, name: true, color: true } },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json(task);
  } catch (error) {
    console.error(`GET /api/tasks/${id}:`, error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      {
        error: "Internal server error",
        ...(detail ? { detail } : {}),
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id } = await params;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = updateTaskSchema.parse(body);

    const task = await prisma.task.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const updated = await prisma.task.update({
      where: { id },
      data,
      include: {
        events: true,
        taskGroup: { select: { id: true, name: true, color: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      );
    }
    console.error("Update task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id } = await params;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const task = await prisma.task.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Stop any active timer for this task before hiding it (DB row and live memory).
  const running = await prisma.activeTimer.findFirst({
    where: { userId: user.id, taskId: id },
  });
  if (running) {
    await persistTimerStop(user.id, id);
    emitToUser(user.id, "timer:stopped", {
      taskId: id,
      duration: Math.max(0, Date.now() - running.startTime.getTime()),
    });
  }

  // Soft delete - hide the task instead of deleting
  await prisma.task.update({
    where: { id },
    data: { hidden: true },
  });

  return NextResponse.json({ success: true, taskHidden: true });
}
