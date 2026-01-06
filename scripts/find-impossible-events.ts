import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { startOfDay, endOfDay, format } from "date-fns";

// Setup prisma with pg adapter (same as main app)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

interface EventWithTask {
  id: string;
  createdAt: Date;
  duration: number;
  name: string;
  taskId: string;
  task: { name: string };
}

async function main() {
  console.log("🔍 Searching for impossible events...\n");

  // Get all events with task info
  const events = await prisma.event.findMany({
    include: { task: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total events: ${events.length}\n`);

  // 1. Find events with duration > 24 hours
  console.log("═══════════════════════════════════════════════════════════");
  console.log("EVENTS WITH DURATION > 24 HOURS:");
  console.log("═══════════════════════════════════════════════════════════");
  
  const longEvents = events.filter((e) => e.duration > MS_PER_DAY);
  if (longEvents.length === 0) {
    console.log("None found.\n");
  } else {
    longEvents.forEach((e) => {
      const hours = (e.duration / MS_PER_HOUR).toFixed(2);
      const days = (e.duration / MS_PER_DAY).toFixed(2);
      console.log(`\n  ID: ${e.id}`);
      console.log(`  Task: ${e.task.name}`);
      console.log(`  Event name: ${e.name}`);
      console.log(`  Created: ${format(e.createdAt, "yyyy-MM-dd HH:mm:ss")}`);
      console.log(`  Duration: ${hours}h (${days} days)`);
    });
    console.log(`\nTotal: ${longEvents.length} events\n`);
  }

  // 2. Find days where total time > 24 hours
  console.log("═══════════════════════════════════════════════════════════");
  console.log("DAYS WITH TOTAL TIME > 24 HOURS:");
  console.log("═══════════════════════════════════════════════════════════");

  // Group events by day and calculate overlap-aware totals
  const dayTotals = new Map<string, { total: number; events: EventWithTask[] }>();

  events.forEach((event) => {
    const eventStart = new Date(event.createdAt);
    const eventEnd = new Date(eventStart.getTime() + event.duration);

    // For each day the event spans
    let currentDay = startOfDay(eventStart);
    while (currentDay <= eventEnd) {
      const dayKey = format(currentDay, "yyyy-MM-dd");
      const dayStart = startOfDay(currentDay);
      const dayEnd = new Date(endOfDay(currentDay).getTime() + 1);

      // Calculate overlap
      const overlapStart = eventStart > dayStart ? eventStart : dayStart;
      const overlapEnd = eventEnd < dayEnd ? eventEnd : dayEnd;
      const overlap = Math.max(0, overlapEnd.getTime() - overlapStart.getTime());

      if (overlap > 0) {
        if (!dayTotals.has(dayKey)) {
          dayTotals.set(dayKey, { total: 0, events: [] });
        }
        const dayData = dayTotals.get(dayKey)!;
        dayData.total += overlap;
        if (!dayData.events.find((e) => e.id === event.id)) {
          dayData.events.push(event);
        }
      }

      // Move to next day
      currentDay = new Date(currentDay.getTime() + MS_PER_DAY);
    }
  });

  // Filter for impossible days
  const impossibleDays = Array.from(dayTotals.entries())
    .filter(([, data]) => data.total > MS_PER_DAY)
    .sort((a, b) => b[1].total - a[1].total);

  if (impossibleDays.length === 0) {
    console.log("None found.\n");
  } else {
    impossibleDays.forEach(([day, data]) => {
      const hours = (data.total / MS_PER_HOUR).toFixed(2);
      console.log(`\n  📅 ${day}: ${hours}h total`);
      console.log(`  Events contributing:`);
      data.events.forEach((e) => {
        const eventHours = (e.duration / MS_PER_HOUR).toFixed(2);
        console.log(`    - ${e.task.name}: "${e.name}" (${eventHours}h) @ ${format(e.createdAt, "HH:mm:ss")}`);
        console.log(`      ID: ${e.id}`);
      });
    });
    console.log(`\nTotal: ${impossibleDays.length} impossible days\n`);
  }

  // 3. Summary of suspicious events (> 12 hours)
  console.log("═══════════════════════════════════════════════════════════");
  console.log("SUSPICIOUS EVENTS (> 12 HOURS):");
  console.log("═══════════════════════════════════════════════════════════");

  const suspiciousEvents = events
    .filter((e) => e.duration > 12 * MS_PER_HOUR)
    .sort((a, b) => b.duration - a.duration);

  if (suspiciousEvents.length === 0) {
    console.log("None found.\n");
  } else {
    suspiciousEvents.slice(0, 20).forEach((e) => {
      const hours = (e.duration / MS_PER_HOUR).toFixed(2);
      console.log(`\n  ${e.task.name}: ${hours}h`);
      console.log(`  Event: "${e.name}"`);
      console.log(`  Started: ${format(e.createdAt, "yyyy-MM-dd HH:mm:ss")}`);
      console.log(`  ID: ${e.id}`);
    });
    if (suspiciousEvents.length > 20) {
      console.log(`\n  ... and ${suspiciousEvents.length - 20} more`);
    }
    console.log(`\nTotal: ${suspiciousEvents.length} suspicious events\n`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
