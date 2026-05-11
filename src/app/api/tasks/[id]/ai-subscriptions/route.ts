import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enrichAiSubscriptionPeriods } from "@/lib/ai-subscription-enrich";
import { z } from "zod";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

const putSchema = z.object({
  periodIds: z.array(z.string().uuid()),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id: taskId } = await params;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const task = await prisma.task.findFirst({
      where: { id: taskId, userId: user.id },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const links = await prisma.taskAiSubscription.findMany({
      where: { taskId },
      select: { aiSubscriptionPeriodId: true },
    });

    return NextResponse.json({
      periodIds: links.map((l) => l.aiSubscriptionPeriodId),
    });
  } catch (error) {
    console.error(`GET /api/tasks/[id]/ai-subscriptions:`, error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id: taskId } = await params;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = putSchema.parse(body);

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId: user.id },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (parsed.periodIds.length > 0) {
      const count = await prisma.aiSubscriptionPeriod.count({
        where: {
          userId: user.id,
          id: { in: parsed.periodIds },
        },
      });
      if (count !== parsed.periodIds.length) {
        return NextResponse.json(
          { error: "One or more subscription periods not found" },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction([
      prisma.taskAiSubscription.deleteMany({ where: { taskId } }),
      ...(parsed.periodIds.length > 0
        ? [
            prisma.taskAiSubscription.createMany({
              data: parsed.periodIds.map((aiSubscriptionPeriodId) => ({
                taskId,
                aiSubscriptionPeriodId,
              })),
            }),
          ]
        : []),
    ]);

    const enriched = await enrichAiSubscriptionPeriods(prisma, user.id);
    return NextResponse.json({
      periodIds: parsed.periodIds,
      periods: enriched.filter((p) => parsed.periodIds.includes(p.id)),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    console.error(`PUT /api/tasks/[id]/ai-subscriptions:`, error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
