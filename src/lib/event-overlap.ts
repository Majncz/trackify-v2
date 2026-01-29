import { prisma } from "./prisma";

interface OverlapCheckParams {
  userId: string;
  eventFrom: Date;
  eventTo: Date;
  excludeEventId?: string; // For updates, exclude the event being updated
  skipRunningTimerCheck?: boolean; // Skip check for running timer (when timer itself is creating event)
}

interface OverlappingEvent {
  id: string;
  name: string;
  from: Date;
  to: Date;
  taskName: string;
}

/**
 * Check if a new event would overlap with existing events for a user.
 * Two events overlap if one starts before the other ends.
 * 
 * Event A: fromA -> toA
 * Event B: fromB -> toB
 * 
 * Overlap occurs when: fromA < toB AND fromB < toA
 */
export async function findOverlappingEvents({
  userId,
  eventFrom,
  eventTo,
  excludeEventId,
  skipRunningTimerCheck,
}: OverlapCheckParams): Promise<OverlappingEvent[]> {
  // Get events that overlap
  // An event overlaps if:
  // - Its start time is before our end time AND
  // - Its end time is after our start time
  const events = await prisma.event.findMany({
    where: {
      task: { userId },
      ...(excludeEventId && { id: { not: excludeEventId } }),
      // Event starts before our event ends
      from: { lt: eventTo },
      // Event ends after our event starts
      to: { gt: eventFrom },
    },
    include: {
      task: { select: { name: true } },
    },
  });

  const result: OverlappingEvent[] = events.map((e) => ({
    id: e.id,
    name: e.name,
    from: e.from,
    to: e.to,
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
      // Overlap if: timerStart < eventTo AND timerEnd > eventFrom
      if (timerStart < eventTo && timerEnd > eventFrom) {
        result.push({
          id: activeTimer.id,
          name: "Currently running timer",
          from: timerStart,
          to: timerEnd,
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
    const overlapStart = first.from.toLocaleString();
    const overlapEnd = first.to.toLocaleString();
    const durationMins = Math.round((first.to.getTime() - first.from.getTime()) / 60000);
    
    throw new OverlapError(
      `This time entry overlaps with "${first.taskName}: ${first.name}" ` +
      `(${overlapStart} - ${overlapEnd}, ${durationMins}min)`,
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
