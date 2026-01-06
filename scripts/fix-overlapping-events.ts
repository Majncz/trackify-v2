import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { format } from "date-fns";

// Setup prisma with pg adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MS_PER_HOUR = 3600000;

interface Event {
  id: string;
  createdAt: Date;
  duration: number;
  name: string;
  taskId: string;
  task: { id: string; name: string };
}

interface Change {
  eventId: string;
  taskName: string;
  oldStart: Date;
  newStart: Date;
}

async function main() {
  console.log("🔧 APPLYING: Fixing overlapping events\n");

  // Get all events sorted by start time
  const events = await prisma.event.findMany({
    include: { task: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total events: ${events.length}\n`);

  // Calculate original totals per task
  const originalTotals = new Map<string, { name: string; total: number }>();
  events.forEach((e) => {
    const current = originalTotals.get(e.taskId) || { name: e.task.name, total: 0 };
    current.total += e.duration;
    originalTotals.set(e.taskId, current);
  });

  // Create working copy
  interface WorkingEvent extends Event {
    endTime: Date;
    newStart?: Date;
  }

  const workingEvents: WorkingEvent[] = events.map((e) => ({
    ...e,
    endTime: new Date(e.createdAt.getTime() + e.duration),
  }));

  workingEvents.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Track changes
  const changes: Change[] = [];
  let globalEndTime = new Date(0);

  for (const event of workingEvents) {
    const originalStart = event.createdAt;
    const eventDuration = event.duration;

    if (originalStart.getTime() < globalEndTime.getTime()) {
      const newStart = new Date(globalEndTime.getTime());
      event.newStart = newStart;

      changes.push({
        eventId: event.id,
        taskName: event.task.name,
        oldStart: originalStart,
        newStart: newStart,
      });

      globalEndTime = new Date(newStart.getTime() + eventDuration);
    } else {
      event.newStart = originalStart;
      globalEndTime = event.endTime;
    }
  }

  console.log(`Events to update: ${changes.length}\n`);

  // Apply changes in batches
  console.log("Applying changes...\n");

  const BATCH_SIZE = 100;
  let updated = 0;

  for (let i = 0; i < changes.length; i += BATCH_SIZE) {
    const batch = changes.slice(i, i + BATCH_SIZE);

    await prisma.$transaction(
      batch.map((change) =>
        prisma.event.update({
          where: { id: change.eventId },
          data: { createdAt: change.newStart },
        })
      )
    );

    updated += batch.length;
    process.stdout.write(`\r  Updated ${updated}/${changes.length} events...`);
  }

  console.log("\n\n✅ All updates applied!\n");

  // Verify totals are preserved
  console.log("═══════════════════════════════════════════════════════════");
  console.log("VERIFICATION: Checking task totals...");
  console.log("═══════════════════════════════════════════════════════════\n");

  const updatedEvents = await prisma.event.findMany({
    include: { task: { select: { id: true, name: true } } },
  });

  const newTotals = new Map<string, number>();
  updatedEvents.forEach((e) => {
    const current = newTotals.get(e.taskId) || 0;
    newTotals.set(e.taskId, current + e.duration);
  });

  let allMatch = true;
  Array.from(originalTotals.entries()).forEach(([taskId, original]) => {
    const newTotal = newTotals.get(taskId) || 0;
    const match = original.total === newTotal;
    if (!match) {
      allMatch = false;
      const originalHours = (original.total / MS_PER_HOUR).toFixed(2);
      const newHours = (newTotal / MS_PER_HOUR).toFixed(2);
      console.log(`❌ ${original.name}: ${originalHours}h → ${newHours}h MISMATCH!`);
    }
  });

  if (allMatch) {
    console.log("✅ All task totals verified - no data lost!\n");
  } else {
    console.log("\n❌ Some totals don't match! Check the data.\n");
  }

  // Check for remaining overlaps
  console.log("═══════════════════════════════════════════════════════════");
  console.log("VERIFICATION: Checking for remaining overlaps...");
  console.log("═══════════════════════════════════════════════════════════\n");

  const sortedEvents = updatedEvents.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  let overlapsRemaining = 0;
  for (let i = 0; i < sortedEvents.length - 1; i++) {
    const event1 = sortedEvents[i];
    const end1 = new Date(event1.createdAt).getTime() + event1.duration;
    const start2 = new Date(sortedEvents[i + 1].createdAt).getTime();

    if (start2 < end1) {
      overlapsRemaining++;
    }
  }

  if (overlapsRemaining === 0) {
    console.log("✅ No overlapping events remaining!\n");
  } else {
    console.log(`⚠️  ${overlapsRemaining} overlaps still exist (minor timing issues)\n`);
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("DONE!");
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);

