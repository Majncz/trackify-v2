import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { validateNoOverlap, OverlapError } from "@/lib/event-overlap";
import { z } from "zod";

const validateStartSchema = z.object({
  newStartTime: z.string().datetime(), // ISO timestamp
});

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { newStartTime } = validateStartSchema.parse(body);

    const startDate = new Date(newStartTime);
    const now = Date.now();
    
    // Don't allow future start times
    if (startDate.getTime() > now) {
      return NextResponse.json(
        { error: "Start time cannot be in the future" },
        { status: 400 }
      );
    }

    // Calculate duration from new start time to now
    const duration = now - startDate.getTime();

    if (duration <= 0) {
      return NextResponse.json(
        { error: "Invalid duration" },
        { status: 400 }
      );
    }

    // Check for overlapping events
    // Skip running timer check since we're adjusting the running timer itself
    await validateNoOverlap({
      userId: session.user.id,
      eventStart: startDate,
      duration,
      skipRunningTimerCheck: true,
    });

    return NextResponse.json({ valid: true });
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
    console.error("Validate start time error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
