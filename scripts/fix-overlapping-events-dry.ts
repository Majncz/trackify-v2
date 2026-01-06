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
const MS_PER_MINUTE = 60000;

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
  eventName: string;
  oldStart: Date;
  newStart: Date;
  duration: number;
  reason: string;
}

async function main() {
  console.log("🔍 DRY RUN: Fixing overlapping events\n");
  console.log("This script will NOT modify the database.\n");

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

  // Create a working copy of events with their end times
  interface WorkingEvent extends Event {
    endTime: Date;
    newStart?: Date;
    newEnd?: Date;
  }

  const workingEvents: WorkingEvent[] = events.map((e) => ({
    ...e,
    endTime: new Date(e.createdAt.getTime() + e.duration),
  }));

  // Sort by start time
  workingEvents.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Track changes
  const changes: Change[] = [];

  // Process events chronologically
  // Strategy: When overlap detected, push the later event to start after the earlier one ends
  // This creates a sequential timeline while preserving all durations

  let globalEndTime = new Date(0); // Track when the last event ends

  for (const event of workingEvents) {
    const originalStart = event.createdAt;
    const eventDuration = event.duration;

    // Check if this event starts before the global end time (overlap)
    if (originalStart.getTime() < globalEndTime.getTime()) {
      // Need to move this event
      const newStart = new Date(globalEndTime.getTime());
      const newEnd = new Date(newStart.getTime() + eventDuration);

      event.newStart = newStart;
      event.newEnd = newEnd;

      changes.push({
        eventId: event.id,
        taskName: event.task.name,
        eventName: event.name,
        oldStart: originalStart,
        newStart: newStart,
        duration: eventDuration,
        reason: `Overlapped with previous event ending at ${format(globalEndTime, "HH:mm:ss")}`,
      });

      globalEndTime = newEnd;
    } else {
      // No overlap, keep original
      event.newStart = originalStart;
      event.newEnd = event.endTime;
      globalEndTime = event.endTime;
    }
  }

  // Calculate new totals per task (should be identical)
  const newTotals = new Map<string, number>();
  workingEvents.forEach((e) => {
    const current = newTotals.get(e.taskId) || 0;
    newTotals.set(e.taskId, current + e.duration);
  });

  // Report
  console.log("═══════════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log(`Events that need to be moved: ${changes.length}`);
  console.log(`Events unchanged: ${events.length - changes.length}\n`);

  // Calculate total time shift
  let totalShiftMs = 0;
  changes.forEach((c) => {
    totalShiftMs += c.newStart.getTime() - c.oldStart.getTime();
  });
  console.log(`Total time shift: ${(totalShiftMs / MS_PER_HOUR).toFixed(2)}h\n`);

  // Verify totals are preserved
  console.log("═══════════════════════════════════════════════════════════");
  console.log("VERIFICATION: Task totals before/after");
  console.log("═══════════════════════════════════════════════════════════\n");

  let allMatch = true;
  Array.from(originalTotals.entries()).forEach(([taskId, original]) => {
    const newTotal = newTotals.get(taskId) || 0;
    const match = original.total === newTotal;
    if (!match) allMatch = false;

    const originalHours = (original.total / MS_PER_HOUR).toFixed(2);
    const newHours = (newTotal / MS_PER_HOUR).toFixed(2);
    const status = match ? "✅" : "❌";

    console.log(`${status} ${original.name}: ${originalHours}h → ${newHours}h`);
  });

  console.log(`\n${allMatch ? "✅ All task totals preserved!" : "❌ MISMATCH DETECTED!"}\n`);

  // Show sample changes
  console.log("═══════════════════════════════════════════════════════════");
  console.log("SAMPLE CHANGES (first 30)");
  console.log("═══════════════════════════════════════════════════════════\n");

  changes.slice(0, 30).forEach((c, idx) => {
    const shiftMs = c.newStart.getTime() - c.oldStart.getTime();
    const shiftMins = Math.round(shiftMs / MS_PER_MINUTE);
    const durationMins = Math.round(c.duration / MS_PER_MINUTE);

    console.log(`${idx + 1}. ${c.taskName}: "${c.eventName}" (${durationMins} min)`);
    console.log(`   OLD: ${format(c.oldStart, "yyyy-MM-dd HH:mm:ss")}`);
    console.log(`   NEW: ${format(c.newStart, "yyyy-MM-dd HH:mm:ss")} (shifted +${shiftMins} min)`);
    console.log(`   ID: ${c.eventId}\n`);
  });

  if (changes.length > 30) {
    console.log(`... and ${changes.length - 30} more changes\n`);
  }

  // Show timeline comparison for a busy day
  const busyDay = "2025-10-26";
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`TIMELINE COMPARISON: ${busyDay}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  const dayEvents = workingEvents.filter(
    (e) => format(e.createdAt, "yyyy-MM-dd") === busyDay ||
           (e.newStart && format(e.newStart, "yyyy-MM-dd") === busyDay)
  );

  console.log("BEFORE (overlapping):");
  dayEvents
    .filter((e) => format(e.createdAt, "yyyy-MM-dd") === busyDay)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .forEach((e) => {
      const start = format(e.createdAt, "HH:mm");
      const end = format(e.endTime, "HH:mm");
      const hours = (e.duration / MS_PER_HOUR).toFixed(1);
      console.log(`  ${start}-${end} (${hours}h) ${e.task.name}`);
    });

  console.log("\nAFTER (sequential):");
  dayEvents
    .filter((e) => e.newStart && format(e.newStart, "yyyy-MM-dd") === busyDay)
    .sort((a, b) => (a.newStart?.getTime() || 0) - (b.newStart?.getTime() || 0))
    .slice(0, 20)
    .forEach((e) => {
      const start = format(e.newStart!, "HH:mm");
      const end = format(e.newEnd!, "HH:mm");
      const hours = (e.duration / MS_PER_HOUR).toFixed(1);
      console.log(`  ${start}-${end} (${hours}h) ${e.task.name}`);
    });

  // SQL preview
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("SQL PREVIEW (first 10 updates)");
  console.log("═══════════════════════════════════════════════════════════\n");

  changes.slice(0, 10).forEach((c) => {
    const newTimestamp = c.newStart.toISOString();
    console.log(`UPDATE trackify_event SET "createdAt" = '${newTimestamp}' WHERE id = '${c.eventId}';`);
  });

  if (changes.length > 10) {
    console.log(`-- ... and ${changes.length - 10} more updates`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("TO APPLY THESE CHANGES:");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("\nRun: npx tsx scripts/fix-overlapping-events.ts --apply\n");

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);

