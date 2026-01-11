import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateNoOverlap, OverlapError } from "@/lib/event-overlap";
import { z } from "zod";

const eventSchema = z.object({
  taskId: z.string().uuid(),
  name: z.string().default("Time entry"),
  duration: z.number().int().positive(),
  createdAt: z.string().datetime().optional(), // ISO timestamp for when the event started
});

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");

  const events = await prisma.event.findMany({
    where: {
      task: {
        userId: session.user.id,
        ...(taskId && { id: taskId }),
      },
    },
    include: {
      task: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(events);
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { taskId, name, duration, createdAt } = eventSchema.parse(body);

    // Verify task belongs to user
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        userId: session.user.id,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Determine event start time
    const eventStart = createdAt ? new Date(createdAt) : new Date();

    // Check for overlapping events
    // Skip running timer check - this endpoint is called by the timer after it stops,
    // so the ActiveTimer record may still briefly exist due to race condition
    await validateNoOverlap({
      userId: session.user.id,
      eventStart,
      duration,
      skipRunningTimerCheck: true,
    });

    const event = await prisma.event.create({
      data: {
        taskId,
        name,
        duration,
        createdAt: eventStart,
      },
      include: {
        task: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      );
    }
    if (error instanceof OverlapError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      );
    }
    console.error("Create event error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
