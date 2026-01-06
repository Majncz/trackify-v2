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

interface Overlap {
  event1: EventWithTask;
  event2: EventWithTask;
  overlapMs: number;
  overlapStart: Date;
  overlapEnd: Date;
}

async function main() {
  console.log("🔍 Searching for overlapping events (concurrent timers)...\n");

  // Get all events with task info, sorted by start time
  const events = await prisma.event.findMany({
    include: { task: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total events: ${events.length}\n`);

  // Find all overlapping event pairs
  const overlaps: Overlap[] = [];

  for (let i = 0; i < events.length; i++) {
    const event1 = events[i];
    const start1 = new Date(event1.createdAt);
    const end1 = new Date(start1.getTime() + event1.duration);

    for (let j = i + 1; j < events.length; j++) {
      const event2 = events[j];
      const start2 = new Date(event2.createdAt);
      const end2 = new Date(start2.getTime() + event2.duration);

      // If event2 starts after event1 ends, no more overlaps possible for event1
      // (since events are sorted by start time)
      if (start2 >= end1) break;

      // Check for overlap: event2 starts before event1 ends
      // Calculate overlap
      const overlapStart = start2; // event2 starts after event1 (sorted)
      const overlapEnd = end1 < end2 ? end1 : end2;
      const overlapMs = overlapEnd.getTime() - overlapStart.getTime();

      if (overlapMs > 0) {
        overlaps.push({
          event1,
          event2,
          overlapMs,
          overlapStart,
          overlapEnd,
        });
      }
    }
  }

  // Sort by overlap duration (biggest first)
  overlaps.sort((a, b) => b.overlapMs - a.overlapMs);

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`OVERLAPPING EVENTS (${overlaps.length} pairs found):`);
  console.log("═══════════════════════════════════════════════════════════");

  if (overlaps.length === 0) {
    console.log("None found.\n");
  } else {
    // Calculate total double-counted time
    let totalDoubleCountedMs = 0;
    overlaps.forEach((o) => {
      totalDoubleCountedMs += o.overlapMs;
    });

    console.log(`\n⚠️  TOTAL DOUBLE-COUNTED TIME: ${(totalDoubleCountedMs / MS_PER_HOUR).toFixed(2)}h\n`);

    // Show significant overlaps (> 1 minute)
    const significantOverlaps = overlaps.filter((o) => o.overlapMs > 60000);
    
    console.log(`Significant overlaps (> 1 min): ${significantOverlaps.length}\n`);

    significantOverlaps.slice(0, 30).forEach((o, idx) => {
      const overlapHours = (o.overlapMs / MS_PER_HOUR).toFixed(2);
      const overlapMins = Math.round(o.overlapMs / 60000);
      
      console.log(`\n${idx + 1}. OVERLAP: ${overlapHours}h (${overlapMins} min)`);
      console.log(`   Period: ${format(o.overlapStart, "yyyy-MM-dd HH:mm")} → ${format(o.overlapEnd, "HH:mm")}`);
      console.log(`   ┌─ Event 1: ${o.event1.task.name}`);
      console.log(`   │  "${o.event1.name}"`);
      console.log(`   │  ${format(o.event1.createdAt, "yyyy-MM-dd HH:mm:ss")} (${(o.event1.duration / MS_PER_HOUR).toFixed(2)}h)`);
      console.log(`   │  ID: ${o.event1.id}`);
      console.log(`   └─ Event 2: ${o.event2.task.name}`);
      console.log(`      "${o.event2.name}"`);
      console.log(`      ${format(o.event2.createdAt, "yyyy-MM-dd HH:mm:ss")} (${(o.event2.duration / MS_PER_HOUR).toFixed(2)}h)`);
      console.log(`      ID: ${o.event2.id}`);
    });

    if (significantOverlaps.length > 30) {
      console.log(`\n... and ${significantOverlaps.length - 30} more significant overlaps`);
    }

    // Group overlaps by day
    console.log("\n\n═══════════════════════════════════════════════════════════");
    console.log("DOUBLE-COUNTED TIME BY DAY:");
    console.log("═══════════════════════════════════════════════════════════\n");

    const byDay = new Map<string, number>();
    overlaps.forEach((o) => {
      const day = format(o.overlapStart, "yyyy-MM-dd");
      byDay.set(day, (byDay.get(day) || 0) + o.overlapMs);
    });

    const sortedDays = Array.from(byDay.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    sortedDays.forEach(([day, ms]) => {
      const hours = (ms / MS_PER_HOUR).toFixed(2);
      console.log(`  ${day}: ${hours}h double-counted`);
    });
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);

