import { prisma } from "./prisma";
import { MIN_EVENT_MS } from "./event-limits";

export { MIN_EVENT_MS };

interface OverlapCheckParams {
  userId: string;
  eventFrom: Date;
  eventTo: Date;
  excludeEventId?: string;
  skipRunningTimerCheck?: boolean;
}

interface OverlappingEvent {
  id: string;
  name: string;
  from: Date;
  to: Date;
  taskName: string;
  kind: "event" | "timer";
  paid: boolean;
}

export async function findOverlappingEvents({
  userId,
  eventFrom,
  eventTo,
  excludeEventId,
  skipRunningTimerCheck,
}: OverlapCheckParams): Promise<OverlappingEvent[]> {
  const events = await prisma.event.findMany({
    where: {
      task: { userId },
      ...(excludeEventId && { id: { not: excludeEventId } }),
      from: { lt: eventTo },
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
    kind: "event",
    paid: Boolean(e.paymentRecordId),
  }));

  if (!skipRunningTimerCheck) {
    const activeTimer = await prisma.activeTimer.findUnique({
      where: { userId },
      include: { task: { select: { name: true } } },
    });

    if (activeTimer) {
      const timerStart = activeTimer.startTime;
      const timerEnd = new Date();

      if (timerStart < eventTo && timerEnd > eventFrom) {
        result.push({
          id: activeTimer.id,
          name: "Currently running timer",
          from: timerStart,
          to: timerEnd,
          taskName: activeTimer.task.name,
          kind: "timer",
          paid: false,
        });
      }
    }
  }

  return result;
}

async function absorbTinyUnpaidEvents(params: OverlapCheckParams): Promise<void> {
  const overlapping = await findOverlappingEvents({
    ...params,
    skipRunningTimerCheck: true,
  });
  const crumbs = overlapping.filter((event) => {
    if (event.kind !== "event" || event.paid) return false;
    return event.to.getTime() - event.from.getTime() < MIN_EVENT_MS;
  });
  if (crumbs.length === 0) return;
  await prisma.event.deleteMany({
    where: { id: { in: crumbs.map((event) => event.id) } },
  });
}

export async function validateNoOverlap(params: OverlapCheckParams): Promise<void> {
  await absorbTinyUnpaidEvents(params);
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
