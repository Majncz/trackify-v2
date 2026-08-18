import type { Server as SocketIOServer } from "socket.io";
import { prisma } from "./prisma";

export interface MemoryTimer {
  taskId: string;
  startTime: number;
  socketIds: Set<string>;
}

const g = globalThis as typeof globalThis & {
  __trackifyIo?: SocketIOServer;
  __trackifyTimers?: Map<string, MemoryTimer>;
};

export function setRealtimeIo(io: SocketIOServer) {
  g.__trackifyIo = io;
}

export function getActiveTimers(): Map<string, MemoryTimer> {
  if (!g.__trackifyTimers) {
    g.__trackifyTimers = new Map();
  }
  return g.__trackifyTimers;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  g.__trackifyIo?.to(`user:${userId}`).emit(event, payload);
}

export function emitPresenceChanged() {
  g.__trackifyIo?.emit("presence:changed");
}

export async function persistTimerStart(
  userId: string,
  taskId: string,
  startTime: number
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId, hidden: false },
    select: { id: true },
  });
  if (!task) {
    throw new Error("Task not found");
  }

  await prisma.activeTimer.upsert({
    where: { userId },
    create: {
      userId,
      taskId,
      startTime: new Date(startTime),
    },
    update: {
      taskId,
      startTime: new Date(startTime),
    },
  });

  const store = getActiveTimers();
  const existing = store.get(userId);
  store.set(userId, {
    taskId,
    startTime,
    socketIds: existing?.socketIds ?? new Set(),
  });
  emitPresenceChanged();
}

export async function persistTimerStop(userId: string, taskId?: string) {
  if (taskId) {
    const memory = getActiveTimers().get(userId);
    const currentTaskId =
      memory?.taskId ??
      (await prisma.activeTimer.findUnique({
        where: { userId },
        select: { taskId: true },
      }))?.taskId;
    if (currentTaskId && currentTaskId !== taskId) {
      return false;
    }
  }

  await prisma.activeTimer.deleteMany({ where: { userId } });
  getActiveTimers().delete(userId);
  emitPresenceChanged();
  return true;
}

export async function persistTimerStartTime(
  userId: string,
  taskId: string,
  newStartTime: number
) {
  const timer = getActiveTimers().get(userId);
  const dbTimer = timer
    ? null
    : await prisma.activeTimer.findUnique({ where: { userId } });

  const currentTaskId = timer?.taskId ?? dbTimer?.taskId;
  if (!currentTaskId) {
    throw new Error("No active timer found to adjust");
  }
  if (currentTaskId !== taskId) {
    throw new Error("Timer has changed. Please try again.");
  }

  await prisma.activeTimer.update({
    where: { userId },
    data: { startTime: new Date(newStartTime) },
  });

  const store = getActiveTimers();
  const existing = store.get(userId);
  if (existing) {
    store.set(userId, { ...existing, startTime: newStartTime });
  } else {
    store.set(userId, {
      taskId,
      startTime: newStartTime,
      socketIds: new Set(),
    });
  }
  emitPresenceChanged();
}
