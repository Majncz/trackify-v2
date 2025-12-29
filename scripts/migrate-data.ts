import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, Client } from "pg";

const OLD_DATABASE_URL = process.env.OLD_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (!OLD_DATABASE_URL) {
  console.error("OLD_DATABASE_URL is not set in .env");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

// Create Prisma client with adapter
const pool = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function migrateData() {
  console.log("Connecting to source database...");
  const oldDb = new Client({ connectionString: OLD_DATABASE_URL });
  await oldDb.connect();
  console.log("Connected to source database");

  try {
    console.log("\n=== Starting Migration ===\n");

    // Migrate users
    console.log("Migrating users...");
    const { rows: users } = await oldDb.query("SELECT * FROM trackify_user");

    for (const user of users) {
      await prisma.user.upsert({
        where: { id: user.id },
        update: {},
        create: {
          id: user.id,
          email: user.email,
          password: user.password, // Already hashed
        },
      });
    }
    console.log(`  Migrated ${users.length} users`);

    // Migrate tasks
    console.log("Migrating tasks...");
    const { rows: tasks } = await oldDb.query("SELECT * FROM trackify_task");

    for (const task of tasks) {
      // Handle both camelCase and lowercase column names from pg
      const userId = task.userId || task.userid;
      await prisma.task.upsert({
        where: { id: task.id },
        update: {},
        create: {
          id: task.id,
          name: task.name,
          hidden: task.hidden ?? false,
          userId: userId,
        },
      });
    }
    console.log(`  Migrated ${tasks.length} tasks`);

    // Migrate events
    console.log("Migrating events...");
    const { rows: events } = await oldDb.query("SELECT * FROM trackify_event");

    // Batch insert for performance
    const batchSize = 100;
    let migrated = 0;

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      await prisma.event.createMany({
        data: batch.map((event) => ({
          id: event.id,
          createdAt: event.createdAt || event.createdat,
          duration: event.duration,
          name: event.name || "Time entry",
          taskId: event.taskId || event.taskid,
        })),
        skipDuplicates: true,
      });
      migrated += batch.length;
      process.stdout.write(
        `\r  Migrated ${migrated}/${events.length} events...`
      );
    }
    console.log(`\n  Migrated ${events.length} events`);

    console.log("\n=== Migration Completed ===\n");

    // Verify counts
    const userCount = await prisma.user.count();
    const taskCount = await prisma.task.count();
    const eventCount = await prisma.event.count();

    console.log("Verification:");
    console.log(`  Users: ${userCount} (source: ${users.length})`);
    console.log(`  Tasks: ${taskCount} (source: ${tasks.length})`);
    console.log(`  Events: ${eventCount} (source: ${events.length})`);

    if (
      userCount === users.length &&
      taskCount === tasks.length &&
      eventCount === events.length
    ) {
      console.log("\n  All data migrated successfully!");
    } else {
      console.log("\n  Warning: Some records may have been skipped (duplicates)");
    }
  } catch (error) {
    console.error("\nMigration failed:", error);
    throw error;
  } finally {
    await oldDb.end();
    await pool.end();
    await prisma.$disconnect();
  }
}

migrateData().catch((e) => {
  console.error(e);
  process.exit(1);
});
