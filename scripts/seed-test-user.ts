/**
 * Creates or resets a minimal dev login (short email + password) and sample tasks + time entries.
 * Login: a@a.com / a
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

const EMAIL = "a@a.com";
const PASSWORD = "a";

const TASK_NAMES = [
  "Coding",
  "drawing",
  "Labubu multiplying",
  "Reading docs",
  "Procrastination olympics",
  "Watering imaginary plants",
];

const ENTRY_NAME_PARTS = [
  "deep work",
  "light session",
  "sprint",
  "focus block",
  "chaos slot",
  "final boss",
];

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

function buildDemoEvents(params: {
  now: Date;
  daysBack: number;
  targetCount: number;
}): { from: Date; to: Date; name: string }[] {
  const { now, daysBack, targetCount } = params;
  const windowStart = new Date(now.getTime() - daysBack * MS_DAY);
  const out: { from: Date; to: Date; name: string }[] = [];

  let tEnd = new Date(now.getTime() - randBetween(3 * MS_MINUTE, 2 * MS_HOUR));

  while (out.length < targetCount) {
    const durationMs = randBetween(15 * MS_MINUTE, 4 * MS_HOUR);
    const idleBeforeMs = randBetween(20 * MS_MINUTE, 18 * MS_HOUR);

    const to = new Date(tEnd.getTime());
    const from = new Date(to.getTime() - durationMs);

    if (from < windowStart) {
      break;
    }

    out.push({
      from,
      to,
      name: `${pick(ENTRY_NAME_PARTS)} (${Math.round(durationMs / MS_MINUTE)}m)`,
    });

    tEnd = new Date(from.getTime() - idleBeforeMs);
    if (tEnd <= windowStart) {
      break;
    }
  }

  return out;
}

async function main() {
  const hashed = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, password: hashed },
    update: { password: hashed },
  });

  await prisma.activeTimer.deleteMany({ where: { userId: user.id } });
  await prisma.taskGroup.deleteMany({ where: { userId: user.id } });
  await prisma.task.deleteMany({ where: { userId: user.id } });

  const tasks = await Promise.all(
    TASK_NAMES.map((name) =>
      prisma.task.create({
        data: { name, userId: user.id },
      })
    )
  );

  const now = new Date();
  const slots = buildDemoEvents({
    now,
    daysBack: 21,
    targetCount: 48,
  });

  const taskByIndex = () => tasks[Math.floor(Math.random() * tasks.length)]!;

  await prisma.event.createMany({
    data: slots.map((slot) => ({
      taskId: taskByIndex().id,
      from: slot.from,
      to: slot.to,
      name: slot.name,
    })),
  });

  console.log(
    `Test user ready → email: ${EMAIL}  password: ${PASSWORD}\n` +
      `Created ${tasks.length} tasks and ${slots.length} time entries (last ~3 weeks, non-overlapping).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
