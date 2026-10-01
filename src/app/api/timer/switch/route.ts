import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/api-auth";
import { switchTo, timerActionErrorResponse } from "@/lib/timer-actions";

const schema = z.object({
  taskId: z.string().uuid(),
  /** When the switch happened (defaults to now; queued offline taps send their tap time). */
  at: z.string().datetime().optional(),
});

/**
 * POST /api/timer/switch — start a task; if another one runs, save its stretch
 * up to the same moment first. Starting the task that already runs is a no-op.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { taskId, at } = schema.parse(await request.json());
    const result = await switchTo(user.id, taskId, at ? new Date(at).getTime() : undefined);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    const mapped = timerActionErrorResponse(error);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
    console.error("Timer switch error:", error);
    return NextResponse.json({ error: "Failed to switch timer" }, { status: 500 });
  }
}
