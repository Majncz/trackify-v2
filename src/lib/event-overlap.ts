import { prisma } from "./prisma";

interface OverlapCheckParams {
  userId: string;
  eventStart: Date;
  duration: number;
  excludeEventId?: string; // For updates, exclude the event being updated
  skipRunningTimerCheck?: boolean; // Skip check for running timer (when timer itself is creating event)
}

interface OverlappingEvent {
  id: string;
  name: string;
  createdAt: Date;
  duration: number;
  taskName: string;
}

/**
 * Check if a new event would overlap with existing events for a user.
 * Two events overlap if one starts before the other ends.
 * 
 * Event A: startA -> endA (startA + durationA)
 * Event B: startB -> endB (startB + durationB)
 * 
 * Overlap occurs when: startA < endB AND startB < endA
 */
export async function findOverlappingEvents({
  userId,
  eventStart,
  duration,
  excludeEventId,
  skipRunningTimerCheck,
}: OverlapCheckParams): Promise<OverlappingEvent[]> {
  const eventEnd = new Date(eventStart.getTime() + duration);

  // Get events that could potentially overlap
  // An event overlaps if:
  // - Its start time is before our end time AND
  // - Its end time (start + duration) is after our start time
  // 
  // We filter by createdAt < eventEnd in the query, then check the second
  // condition (existingEnd > eventStart) in JavaScript since Prisma can't
  // do computed column comparisons
  const events = await prisma.event.findMany({
    where: {
      task: { userId },
      ...(excludeEventId && { id: { not: excludeEventId } }),
      // Event starts before our event ends
      createdAt: { lt: eventEnd },
    },
    include: {
      task: { select: { name: true } },
    },
  });

  // Filter to find actual overlaps (event end > our start)
  const overlapping = events.filter((event) => {
    const existingEnd = new Date(event.createdAt.getTime() + event.duration);
    return existingEnd > eventStart;
  });

  const result: OverlappingEvent[] = overlapping.map((e) => ({
    id: e.id,
    name: e.name,
    createdAt: e.createdAt,
    duration: e.duration,
    taskName: e.task.name,
  }));

  // Also check for running timer (if not skipped)
  // A running timer occupies time from its startTime until now
  if (!skipRunningTimerCheck) {
    const activeTimer = await prisma.activeTimer.findUnique({
      where: { userId },
      include: { task: { select: { name: true } } },
    });

    if (activeTimer) {
      const timerStart = activeTimer.startTime;
      const timerEnd = new Date(); // Running timers extend to "now"
      
      // Check if new event overlaps with running timer
      // Overlap if: timerStart < eventEnd AND timerEnd > eventStart
      if (timerStart < eventEnd && timerEnd > eventStart) {
        result.push({
          id: activeTimer.id,
          name: "Currently running timer",
          createdAt: timerStart,
          duration: timerEnd.getTime() - timerStart.getTime(),
          taskName: activeTimer.task.name,
        });
      }
    }
  }

  return result;
}

/**
 * Check if an event would overlap and throw an error if it does.
 */
export async function validateNoOverlap(params: OverlapCheckParams): Promise<void> {
  const overlapping = await findOverlappingEvents(params);

  if (overlapping.length > 0) {
    const first = overlapping[0];
    const overlapStart = first.createdAt.toLocaleString();
    const durationMins = Math.round(first.duration / 60000);
    
    throw new OverlapError(
      `This time entry overlaps with "${first.taskName}: ${first.name}" ` +
      `(${overlapStart}, ${durationMins}min)`,
      overlapping
    );
  }
}

export class OverlapError extends Error {
  public overlappingEvents: OverlappingEvent[];

  constructor(message: string, overlappingEvents: OverlappingEvent[]) {
    super(message);
    this.name = "OverlapError";
    this.overlappingEvents = overlappingEvents;
  }
}
