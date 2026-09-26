import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/api-auth";
import { stopAndSave, timerActionErrorResponse } from "@/lib/timer-actions";

const schema = z.object({
  /** Only stop if this task is the one running. */
  taskId: z.string().uuid().optional(),
  /** Save the stretch from here instead of the stored start (e.g. "fix this session"). */
  startTime: z.string().datetime().optional(),
  /** Stop in the past (defaults to now). Clamped to now. */
  endTime: z.string().datetime().optional(),
  name: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/timer/stop — save the running stretch as a time entry and stop.
 * Stretches under a minute are dropped, like the web. 409 (with `overlap`) leaves the timer running.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const { taskId, startTime, endTime, name } = schema.parse(body ?? {});
    const result = await stopAndSave(user.id, {
      taskId,
      startTime: startTime ? new Date(startTime).getTime() : undefined,
      endTime: endTime ? new Date(endTime).getTime() : undefined,
      name,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    const mapped = timerActionErrorResponse(error);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
    console.error("Timer stop error:", error);
    return NextResponse.json({ error: "Failed to stop timer" }, { status: 500 });
  }
}
