import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { QueueSyncFailure } from "@trackify/shared-types";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { parseStartedAtForSync, resolveStoppedAtForSync } from "./validation";

const actionSchema = z.object({
  id: z.string(),
  type: z.enum(["START_TIMER", "STOP_TIMER", "UPDATE_NOTE", "SWITCH_TASK"]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  attempts: z.number(),
});

const syncSchema = z.object({
  actions: z.array(actionSchema),
});

function pushFailure(
  failures: QueueSyncFailure[],
  id: string,
  message: string,
  permanent = false,
) {
  failures.push({ id, message, ...(permanent ? { permanent: true } : {}) });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { actions } = syncSchema.parse(body);

    let synced = 0;
    const failed: QueueSyncFailure[] = [];
    let activeTimer = await prisma.activeTimer.findUnique({
      where: { userId: user.id },
      include: { task: { select: { hidden: true } } },
    });
    if (activeTimer?.task.hidden) {
      await prisma.activeTimer.delete({ where: { userId: user.id } });
      activeTimer = null;
    }
    let createdTimerThisSync = false;
    let ambiguousState = false;

    for (const action of actions) {
      try {
        if (action.type === "START_TIMER") {
          const taskId = typeof action.payload.taskId === "string" ? action.payload.taskId : null;
          const startedAtResult = parseStartedAtForSync({
            payloadStartedAt: action.payload.startedAt,
            actionCreatedAt: action.createdAt,
          });

          if (!taskId) {
            pushFailure(failed, action.id, "Missing taskId", true);
            continue;
          }

          if (startedAtResult.ok === false) {
            pushFailure(failed, action.id, startedAtResult.message, startedAtResult.permanent);
            continue;
          }

          const startedAt = startedAtResult.value;

          const task = await prisma.task.findFirst({
            where: { id: taskId, userId: user.id, hidden: false },
          });

          if (!task) {
            pushFailure(failed, action.id, "Task not found", true);
            continue;
          }

          if (activeTimer) {
            const sameTask = activeTimer.taskId === taskId;
            const sameStartTime = activeTimer.startTime.getTime() === startedAt.getTime();
            if (!sameTask || !sameStartTime) {
              ambiguousState = true;
              pushFailure(failed, action.id, "Active timer mismatch", true);
              continue;
            }

            createdTimerThisSync = true;
            synced += 1;
            continue;
          }

          activeTimer = await prisma.activeTimer.create({
            data: {
              userId: user.id,
              taskId,
              startTime: startedAt,
            },
            include: { task: { select: { hidden: true } } },
          });
          createdTimerThisSync = true;

          synced += 1;
          continue;
        }

        if (action.type === "STOP_TIMER") {
          const expectedEntryId = typeof action.payload.entryId === "string" ? action.payload.entryId : null;
          const expectedTaskId = typeof action.payload.taskId === "string" ? action.payload.taskId : null;
          const expectedStartedAt =
            typeof action.payload.startedAt === "string" && !Number.isNaN(new Date(action.payload.startedAt).getTime())
              ? new Date(action.payload.startedAt)
              : null;

          if (!activeTimer) {
            ambiguousState = true;
            pushFailure(failed, action.id, "No active timer to stop", true);
            continue;
          }

          const isLocalEntryId = Boolean(expectedEntryId?.startsWith("local-"));
          const matchesTimerContext = Boolean(
            expectedTaskId &&
              expectedStartedAt &&
              activeTimer.taskId === expectedTaskId &&
              activeTimer.startTime.getTime() === expectedStartedAt.getTime(),
          );
          if (isLocalEntryId && !createdTimerThisSync && !matchesTimerContext) {
            ambiguousState = true;
            pushFailure(failed, action.id, "Active timer mismatch", true);
            continue;
          }

          if (isLocalEntryId && ambiguousState && !matchesTimerContext) {
            pushFailure(failed, action.id, "Active timer mismatch", true);
            continue;
          }

          if (expectedEntryId && !isLocalEntryId && expectedEntryId !== activeTimer.id) {
            ambiguousState = true;
            pushFailure(failed, action.id, "Active timer mismatch", true);
            continue;
          }

          const stoppedAtResult = resolveStoppedAtForSync({
            payloadStoppedAt: action.payload.stoppedAt,
            activeTimerStartedAt: activeTimer.startTime,
          });

          if (stoppedAtResult.ok === false) {
            pushFailure(failed, action.id, stoppedAtResult.message, stoppedAtResult.permanent);
            continue;
          }

          const stoppedAt = stoppedAtResult.value;

          await prisma.event.create({
            data: {
              taskId: activeTimer.taskId,
              name: "Time entry",
              from: activeTimer.startTime,
              to: stoppedAt,
            },
          });

          await prisma.activeTimer.delete({ where: { userId: user.id } });
          activeTimer = null;
          synced += 1;
          continue;
        }

        pushFailure(failed, action.id, `Unsupported action type: ${action.type}`, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to sync action";
        pushFailure(failed, action.id, message);
      }
    }

    return NextResponse.json({ synced, failed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    console.error("Sync timer queue error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
