/**
 * Creates or resets a minimal dev login (short email + password), task groups,
 * tasks, time entries, and billing enrollment + sample payment history.
 * Login: a@a.com / a
 *
 * Does not seed AI subscription data.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { GROUP_COLOR_PRESETS } from "../src/lib/group-color-presets";
import { eventToBillingSession } from "../src/lib/billing";
import { subDays } from "date-fns";

const EMAIL = "a@a.com";
const PASSWORD = "a";

/** Demo workspace groups (colors from app palette). */
const GROUP_DEFS = [
  { name: "Client work", color: GROUP_COLOR_PRESETS[5]! },
  { name: "Creative", color: GROUP_COLOR_PRESETS[3]! },
  { name: "Side quests", color: GROUP_COLOR_PRESETS[6]! },
] as const;

/** Tasks and which group they belong to (index into GROUP_DEFS, or null = ungrouped). */
const TASKS: { name: string; groupIdx: number | null }[] = [
  { name: "Coding", groupIdx: 0 },
  { name: "Reading docs", groupIdx: 0 },
  { name: "drawing", groupIdx: 1 },
  { name: "Labubu multiplying", groupIdx: 1 },
  { name: "Watering imaginary plants", groupIdx: 2 },
  { name: "Procrastination olympics", groupIdx: null },
];

/** Tasks enrolled in billing (others have time but no rate). */
const BILLING_BY_TASK_NAME: Record<
  string,
  {
    hourlyRate: number;
    currency: string;
    roundingMins: number;
  }
> = {
  Coding: {
    hourlyRate: 950,
    currency: "CZK",
    roundingMins: 15,
  },
  "Reading docs": {
    hourlyRate: 520,
    currency: "CZK",
    roundingMins: 0,
  },
  drawing: {
    hourlyRate: 620,
    currency: "CZK",
    roundingMins: 30,
  },
};

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

async function markEventsPaid(params: {
  userId: string;
  events: Array<{
    id: string;
    from: Date;
    to: Date;
    name: string;
    taskId: string;
    task: { name: string };
  }>;
  billingByTaskId: Map<
    string,
    {
      hourlyRate: number;
      roundingMins: number;
      currency: string;
    }
  >;
  paidAt: Date;
  note: string | null;
}): Promise<number> {
  const { userId, events, billingByTaskId, paidAt, note } = params;
  if (events.length === 0) return 0;

  let totalAmount = 0;
  let totalMinutes = 0;
  let paymentCurrency: string | null = null;
  const ids: string[] = [];
  const lineAmounts: Record<string, number> = {};

  for (const ev of events) {
    const bt = billingByTaskId.get(ev.taskId);
    if (!bt) continue;

    const row = eventToBillingSession(
      {
        id: ev.id,
        from: ev.from,
        to: ev.to,
        name: ev.name,
        taskId: ev.taskId,
        paymentRecordId: null,
        paidAmount: null,
      },
      ev.task.name,
      {
        hourlyRate: bt.hourlyRate,
        roundingMins: bt.roundingMins,
        currency: bt.currency,
      },
      null,
      null
    );

    ids.push(ev.id);
    lineAmounts[ev.id] = Math.round(row.earnings * 100) / 100;
    totalAmount += row.earnings;
    totalMinutes += row.durationMinutes;
    if (paymentCurrency === null) paymentCurrency = bt.currency;
  }

  if (ids.length === 0) return 0;

  totalAmount = Math.round(totalAmount * 100) / 100;

  await prisma.$transaction(async (tx) => {
    const created = await tx.paymentRecord.create({
      data: {
        userId,
        paidAt,
        note,
        totalAmount,
        totalMinutes,
        currency: paymentCurrency ?? "CZK",
      },
    });
    for (const id of ids) {
      await tx.event.update({
        where: { id },
        data: {
          paymentRecordId: created.id,
          paidAmount: lineAmounts[id] ?? 0,
        },
      });
    }
  });

  return ids.length;
}

async function main() {
  const hashed = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, password: hashed },
    update: { password: hashed },
  });

  await prisma.activeTimer.deleteMany({ where: { userId: user.id } });
  await prisma.paymentRecord.deleteMany({ where: { userId: user.id } });
  await prisma.taskGroup.deleteMany({ where: { userId: user.id } });
  await prisma.task.deleteMany({ where: { userId: user.id } });

  const groups = await Promise.all(
    GROUP_DEFS.map((g) =>
      prisma.taskGroup.create({
        data: {
          name: g.name,
          color: g.color,
          userId: user.id,
        },
      })
    )
  );

  const tasks = await Promise.all(
    TASKS.map(({ name, groupIdx }) =>
      prisma.task.create({
        data: {
          name,
          userId: user.id,
          taskGroupId:
            groupIdx != null && groups[groupIdx] != null
              ? groups[groupIdx]!.id
              : null,
        },
      })
    )
  );

  let billingTaskCount = 0;
  for (const t of tasks) {
    const cfg = BILLING_BY_TASK_NAME[t.name];
    if (!cfg) continue;
    await prisma.billingTask.create({
      data: {
        taskId: t.id,
        userId: user.id,
        hourlyRate: cfg.hourlyRate,
        currency: cfg.currency,
        roundingMins: cfg.roundingMins,
      },
    });
    billingTaskCount += 1;
  }

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

  const billingRows = await prisma.billingTask.findMany({
    where: { userId: user.id },
  });
  const billingByTaskId = new Map(
    billingRows.map((b) => [
      b.taskId,
      {
        hourlyRate: b.hourlyRate,
        roundingMins: b.roundingMins,
        currency: b.currency,
      },
    ])
  );
  const billTaskIds = billingRows.map((b) => b.taskId);

  const billEvents = await prisma.event.findMany({
    where: { taskId: { in: billTaskIds } },
    include: { task: { select: { name: true } } },
  });

  type Qualified = { from: Date; ev: (typeof billEvents)[number] };
  const qualified: Qualified[] = [];
  for (const ev of billEvents) {
    const bt = billingByTaskId.get(ev.taskId);
    if (!bt) continue;
    const row = eventToBillingSession(
      {
        id: ev.id,
        from: ev.from,
        to: ev.to,
        name: ev.name,
        taskId: ev.taskId,
        paymentRecordId: null,
        paidAmount: null,
      },
      ev.task.name,
      {
        hourlyRate: bt.hourlyRate,
        roundingMins: bt.roundingMins,
        currency: bt.currency,
      },
      null,
      null
    );
    qualified.push({ from: ev.from, ev });
  }
  qualified.sort((a, b) => a.from.getTime() - b.from.getTime());

  const n = qualified.length;
  let paidSessionCount = 0;
  let paymentBatchCount = 0;

  if (n >= 8) {
    const cut1 = Math.floor(n * 0.34);
    const cut2 = Math.floor(n * 0.62);
    const first = await markEventsPaid({
      userId: user.id,
      events: qualified.slice(0, cut1).map((q) => q.ev),
      billingByTaskId,
      paidAt: subDays(now, 14),
      note: "Demo — older sessions",
    });
    if (first > 0) paymentBatchCount += 1;
    paidSessionCount += first;

    const second = await markEventsPaid({
      userId: user.id,
      events: qualified.slice(cut1, cut2).map((q) => q.ev),
      billingByTaskId,
      paidAt: subDays(now, 4),
      note: "Demo — recent payout",
    });
    if (second > 0) paymentBatchCount += 1;
    paidSessionCount += second;
  } else if (n >= 2) {
    const cut = Math.max(1, Math.floor(n / 2));
    paidSessionCount = await markEventsPaid({
      userId: user.id,
      events: qualified.slice(0, cut).map((q) => q.ev),
      billingByTaskId,
      paidAt: subDays(now, 7),
      note: "Demo payout",
    });
    paymentBatchCount = paidSessionCount > 0 ? 1 : 0;
  }

  const unpaidBillableSessions = n - paidSessionCount;

  console.log(
    `Test user ready → email: ${EMAIL}  password: ${PASSWORD}\n` +
      `Created ${groups.length} task groups, ${tasks.length} tasks, ${slots.length} time entries (last ~3 weeks, non-overlapping).\n` +
      `Billing: ${billingTaskCount} tasks with rates; ${paidSessionCount} sessions in ${paymentBatchCount} payment record(s); ${unpaidBillableSessions} billable sessions still unpaid.`
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
