import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateTaskSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  hidden: z.boolean().optional(),
});

export async function GET(
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
    include: {
      events: {
        orderBy: { from: "desc" },
      },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
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

  // Stop any active timer for this task before hiding it
  await prisma.activeTimer.deleteMany({
    where: {
      userId: user.id,
      taskId: id,
    },
  });

  // Soft delete - hide the task instead of deleting
  await prisma.task.update({
    where: { id },
    data: { hidden: true },
  });

  return NextResponse.json({ success: true, taskHidden: true });
}
