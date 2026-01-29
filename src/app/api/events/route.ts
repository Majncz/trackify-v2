import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { validateNoOverlap, OverlapError } from "@/lib/event-overlap";
import { z } from "zod";

const eventSchema = z.object({
  taskId: z.string().uuid(),
  name: z.string().default("Time entry"),
  from: z.string().datetime(), // ISO timestamp for when the event started
  to: z.string().datetime(),   // ISO timestamp for when the event ended
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");

  const events = await prisma.event.findMany({
    where: {
      task: {
        userId: user.id,
        ...(taskId && { id: taskId }),
      },
    },
    include: {
      task: {
        select: { name: true },
      },
    },
    orderBy: { from: "desc" },
  });

  return NextResponse.json(events);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { taskId, name, from, to } = eventSchema.parse(body);

    // Verify task belongs to user
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        userId: user.id,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Parse dates
    const eventFrom = new Date(from);
    const eventTo = new Date(to);

    // Validate to > from
    if (eventTo <= eventFrom) {
      return NextResponse.json(
        { error: "End time must be after start time" },
        { status: 400 }
      );
    }

    // Validate event doesn't end in the future
    if (eventTo > new Date()) {
      return NextResponse.json(
        { error: "Cannot create event that ends in the future" },
        { status: 400 }
      );
    }

    // Check for overlapping events
    // Skip running timer check - this endpoint is called by the timer after it stops,
    // so the ActiveTimer record may still briefly exist due to race condition
    await validateNoOverlap({
      userId: user.id,
      eventFrom,
      eventTo,
      skipRunningTimerCheck: true,
    });

    const event = await prisma.event.create({
      data: {
        taskId,
        name,
        from: eventFrom,
        to: eventTo,
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
