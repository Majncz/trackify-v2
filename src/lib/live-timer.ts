import { endOfDay, startOfDay } from "date-fns";
import type { Task } from "@/hooks/use-tasks";

export function liveOverlapMs(
  startTime: number,
  now: number,
  rangeStart: number,
  rangeEnd: number
): number {
  if (now <= rangeStart || startTime >= rangeEnd) return 0;
  return Math.max(0, Math.min(now, rangeEnd) - Math.max(startTime, rangeStart));
}

export function liveRangeMs(
  startTime: number,
  now: number,
  rangeStart: Date,
  rangeEnd: Date
): number {
  return liveOverlapMs(startTime, now, rangeStart.getTime(), rangeEnd.getTime() + 1);
}

export function liveTodayMs(startTime: number, now = Date.now()): number {
  const today = new Date(now);
  return liveRangeMs(startTime, now, startOfDay(today), endOfDay(today));
}

export function tasksWithLiveTimer(
  tasks: Task[],
  live: { running: boolean; taskId: string | null; startTime: number | null },
  now = Date.now()
): Task[] {
  if (!live.running || !live.taskId || !live.startTime) return tasks;
  return tasks.map((task) => {
    if (task.id !== live.taskId) return task;
    return {
      ...task,
      events: [
        ...task.events,
        {
          id: "live-timer",
          from: new Date(live.startTime!).toISOString(),
          to: new Date(now).toISOString(),
          name: "Time entry",
          taskId: task.id,
        },
      ],
    };
  });
}
