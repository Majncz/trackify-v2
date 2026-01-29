import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { validateNoOverlap, OverlapError } from "@/lib/event-overlap";
import { z } from "zod";

const updateEventSchema = z.object({
  name: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

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
    const data = updateEventSchema.parse(body);

    // Verify event belongs to user's task
    const event = await prisma.event.findFirst({
      where: {
        id,
        task: {
          userId: user.id,
        },
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Validate no overlap if from or to is being changed
    if (data.from !== undefined || data.to !== undefined) {
      const finalFrom = data.from ? new Date(data.from) : event.from;
      const finalTo = data.to ? new Date(data.to) : event.to;
      
      // Validate to > from
      if (finalTo <= finalFrom) {
        return NextResponse.json(
          { error: "End time must be after start time" },
          { status: 400 }
        );
      }

      // Validate that event doesn't end in the future
      if (finalTo > new Date()) {
        return NextResponse.json(
          { error: "Cannot update event to end in the future" },
          { status: 400 }
        );
      }

      await validateNoOverlap({
        userId: user.id,
        eventFrom: finalFrom,
        eventTo: finalTo,
        excludeEventId: id,
      });
    }

    // Prepare update data
    const updateData: { name?: string; from?: Date; to?: Date } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.from !== undefined) updateData.from = new Date(data.from);
    if (data.to !== undefined) updateData.to = new Date(data.to);

    const updated = await prisma.event.update({
      where: { id },
      data: updateData,
      include: {
        task: {
          select: { name: true },
        },
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
    if (error instanceof OverlapError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      );
    }
    console.error("Update event error:", error);
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

  // Verify event belongs to user's task
  const event = await prisma.event.findFirst({
    where: {
      id,
      task: {
        userId: user.id,
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  await prisma.event.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
