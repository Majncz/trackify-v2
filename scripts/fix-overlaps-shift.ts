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

interface EventWithTask {
  id: string;
  createdAt: Date;
  duration: number;
  name: string;
  taskId: string;
  task: { name: string };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  
  console.log(dryRun ? "🔍 DRY RUN - No changes will be made\n" : "🔧 FIXING OVERLAPS\n");

  // Get all events sorted by start time
  const events = await prisma.event.findMany({
    include: { task: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total events: ${events.length}\n`);

  // Track total time per task before changes
  const taskTimeBefore = new Map<string, number>();
  events.forEach((e) => {
    taskTimeBefore.set(e.taskId, (taskTimeBefore.get(e.taskId) || 0) + e.duration);
  });

  // Process events and fix overlaps
  const updates: { id: string; oldStart: Date; newStart: Date; task: string }[] = [];
  
  // We'll track the "timeline" - the end time of the last processed event
  // Events are sorted by createdAt, so we process in order
  let timelineEnd = new Date(0); // Start of time

  for (const event of events) {
    const eventStart = new Date(event.createdAt);
    const eventEnd = new Date(eventStart.getTime() + event.duration);

    if (eventStart < timelineEnd) {
      // This event overlaps with a previous event
      // Shift it to start at timelineEnd
      const newStart = new Date(timelineEnd);
      
      updates.push({
        id: event.id,
        oldStart: eventStart,
        newStart,
        task: event.task.name,
      });

      // Update timeline end based on new position
      timelineEnd = new Date(newStart.getTime() + event.duration);
    } else {
      // No overlap, update timeline end
      timelineEnd = eventEnd;
    }
  }

  if (updates.length === 0) {
    console.log("✅ No overlapping events found!\n");
  } else {
    console.log(`Found ${updates.length} events that need to be shifted:\n`);
    console.log("═══════════════════════════════════════════════════════════");

    for (const update of updates) {
      const shiftMs = update.newStart.getTime() - update.oldStart.getTime();
      const shiftMins = Math.round(shiftMs / 60000);
      
      console.log(`\n  ${update.task}`);
      console.log(`  ID: ${update.id}`);
      console.log(`  Old start: ${format(update.oldStart, "yyyy-MM-dd HH:mm:ss")}`);
      console.log(`  New start: ${format(update.newStart, "yyyy-MM-dd HH:mm:ss")}`);
      console.log(`  Shifted by: ${shiftMins} minutes`);
    }

    console.log("\n═══════════════════════════════════════════════════════════\n");

    if (!dryRun) {
      console.log("Applying changes...\n");

      for (const update of updates) {
        await prisma.event.update({
          where: { id: update.id },
          data: { createdAt: update.newStart },
        });
      }

      console.log(`✅ Updated ${updates.length} events\n`);

      // Verify total time per task is unchanged
      const eventsAfter = await prisma.event.findMany();
      const taskTimeAfter = new Map<string, number>();
      eventsAfter.forEach((e) => {
        taskTimeAfter.set(e.taskId, (taskTimeAfter.get(e.taskId) || 0) + e.duration);
      });

      console.log("Verifying task totals are unchanged:");
      let allMatch = true;
      Array.from(taskTimeBefore.entries()).forEach(([taskId, timeBefore]) => {
        const timeAfter = taskTimeAfter.get(taskId) || 0;
        if (timeBefore !== timeAfter) {
          console.log(`  ❌ Task ${taskId}: ${timeBefore}ms -> ${timeAfter}ms`);
          allMatch = false;
        }
      });
      
      if (allMatch) {
        console.log("  ✅ All task totals match!\n");
      }
    } else {
      console.log("Run without --dry-run to apply changes.\n");
    }
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
