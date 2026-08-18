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

export function liveTodayMs(startTime: number, now = Date.now()): number {
  const todayStart = startOfDay(new Date(now)).getTime();
  const todayEnd = endOfDay(new Date(now)).getTime() + 1;
  return liveOverlapMs(startTime, now, todayStart, todayEnd);
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
