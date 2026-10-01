import { prisma } from "./prisma";
import { MIN_EVENT_MS, OverlapError, validateNoOverlap } from "./event-overlap";
import { emitToUser, persistTimerStart, persistTimerStop } from "./timer-runtime";

/**
 * Server-side "save the stretch and stop" / "switch task" for native clients
 * (menu bar, widgets, notification actions). The web keeps its own queue; these
 * exist so a one-tap action can never drop the running stretch.
 */

const MAX_LOOKBACK_MS = 40 * 60 * 60 * 1000;

export class TimerActionError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface SavedStretch {
  id: string;
  taskId: string;
  from: string;
  to: string;
  name: string;
}

async function saveStretch(
  userId: string,
  taskId: string,
  from: number,
  to: number,
  name: string
): Promise<SavedStretch | null> {
  if (to - from < MIN_EVENT_MS) return null;
  await validateNoOverlap({
    userId,
    eventFrom: new Date(from),
    eventTo: new Date(to),
    skipRunningTimerCheck: true,
  });
  const event = await prisma.event.create({
    data: { taskId, name, from: new Date(from), to: new Date(to) },
  });
  return {
    id: event.id,
    taskId,
    from: event.from.toISOString(),
    to: event.to.toISOString(),
    name: event.name,
  };
}

export async function stopAndSave(
  userId: string,
  opts: { taskId?: string; startTime?: number; endTime?: number; name?: string }
) {
  const timer = await prisma.activeTimer.findUnique({ where: { userId } });
  if (!timer || (opts.taskId && timer.taskId !== opts.taskId)) {
    return {
      stopped: false,
      running: Boolean(timer),
      event: null as SavedStretch | null,
    };
  }
  const now = Date.now();
  const start = opts.startTime ?? timer.startTime.getTime();
  const end = Math.min(opts.endTime ?? now, now);
  if (start > now) throw new TimerActionError("Start time cannot be in the future", 400);
  if (start < now - MAX_LOOKBACK_MS) throw new TimerActionError("Start time is too old", 400);
  if (end <= start) throw new TimerActionError("Stop time must be after the start", 400);

  const event = await saveStretch(userId, timer.taskId, start, end, opts.name ?? "Time entry");
  await persistTimerStop(userId, timer.taskId);
  emitToUser(userId, "timer:stopped", {
    taskId: timer.taskId,
    duration: Math.max(0, end - start),
  });
  return { stopped: true, running: false, event, skipped: event === null };
}

export async function switchTo(userId: string, taskId: string, at?: number) {
  const now = Date.now();
  let when = at ?? now;
  if (Number.isNaN(when) || when > now + 5000) when = now;
  when = Math.min(when, now);
  if (when < now - MAX_LOOKBACK_MS) throw new TimerActionError("Start time is too old", 400);

  const task = await prisma.task.findFirst({
    where: { id: taskId, userId, hidden: false },
    select: { id: true },
  });
  if (!task) throw new TimerActionError("Task not found", 404);

  const timer = await prisma.activeTimer.findUnique({ where: { userId } });
  if (timer && timer.taskId === taskId) {
    return { running: true, taskId, startTime: timer.startTime.getTime(), event: null };
  }

  let event: SavedStretch | null = null;
  if (timer) {
    const start = timer.startTime.getTime();
    if (when < start) {
      throw new TimerActionError("Switch time is before the running timer started", 400);
    }
    event = await saveStretch(userId, timer.taskId, start, when, "Time entry");
    await persistTimerStop(userId, timer.taskId);
    emitToUser(userId, "timer:stopped", { taskId: timer.taskId, duration: when - start });
  } else {
    // Starting in the past must not run over existing entries.
    if (now - when >= 1000) {
      await validateNoOverlap({
        userId,
        eventFrom: new Date(when),
        eventTo: new Date(now),
        skipRunningTimerCheck: true,
      });
    }
  }

  await persistTimerStart(userId, taskId, when);
  emitToUser(userId, "timer:started", { taskId, startTime: when });
  return { running: true, taskId, startTime: when, event };
}

export function timerActionErrorResponse(error: unknown) {
  if (error instanceof OverlapError) {
    const first = error.overlappingEvents[0];
    return {
      status: 409,
      body: {
        error: error.message,
        overlap: first
          ? {
              taskName: first.taskName,
              name: first.name,
              from: first.from.toISOString(),
              to: first.to.toISOString(),
            }
          : null,
      },
    };
  }
  if (error instanceof TimerActionError) {
    return { status: error.status, body: { error: error.message } };
  }
  if (error instanceof Error && error.message === "Task not found") {
    return { status: 404, body: { error: error.message } };
  }
  return null;
}
