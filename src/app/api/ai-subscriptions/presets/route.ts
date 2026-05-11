import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { ensureBuiltInAiPresets } from "@/lib/ai-subscription-metrics";
import { z } from "zod";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

const createPresetSchema = z.object({
  name: z.string().min(1).max(120),
  providerKey: z.string().max(64).optional().nullable(),
  sortOrder: z.number().int().optional(),
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureBuiltInAiPresets(prisma, user.id);
    const rows = await prisma.aiSubscriptionPreset.findMany({
      where: { userId: user.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error("GET /api/ai-subscriptions/presets:", error);
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
    await ensureBuiltInAiPresets(prisma, user.id);
    const body = await request.json();
    const parsed = createPresetSchema.parse(body);

    const maxSort = await prisma.aiSubscriptionPreset.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });
    const sortOrder =
      parsed.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;

    const row = await prisma.aiSubscriptionPreset.create({
      data: {
        userId: user.id,
        name: parsed.name.trim(),
        providerKey: parsed.providerKey?.trim() || null,
        isBuiltIn: false,
        sortOrder,
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
    console.error("POST /api/ai-subscriptions/presets:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
