import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const roundingValues = [0, 15, 30, 60] as const;

const enrollSchema = z.object({
  taskId: z.string().uuid(),
  hourlyRate: z.number().nonnegative(),
  currency: z.string().min(1).max(12).default("CZK"),
  roundingMins: z
    .number()
    .int()
    .refine((v) => (roundingValues as readonly number[]).includes(v), {
      message: "roundingMins must be 0, 15, 30, or 60",
    })
    .default(0),
  minSessionMins: z.number().int().min(0).max(24 * 60).default(0),
});

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

const taskInclude = {
  id: true,
  name: true,
  hidden: true,
  taskGroup: { select: { id: true, name: true, color: true } },
} as const;

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await prisma.billingTask.findMany({
      where: { userId: user.id },
      include: {
        task: { select: taskInclude },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(rows);
  } catch (error) {
    console.error("GET /api/billing/tasks:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = enrollSchema.parse(body);

    const task = await prisma.task.findFirst({
      where: { id: parsed.taskId, userId: user.id },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const existing = await prisma.billingTask.findUnique({
      where: { taskId: parsed.taskId },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Task is already enrolled in billing" },
        { status: 409 }
      );
    }

    const row = await prisma.billingTask.create({
      data: {
        taskId: parsed.taskId,
        userId: user.id,
        hourlyRate: parsed.hourlyRate,
        currency: parsed.currency,
        roundingMins: parsed.roundingMins,
        minSessionMins: parsed.minSessionMins,
      },
      include: {
        task: { select: taskInclude },
      },
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    console.error("POST /api/billing/tasks:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
