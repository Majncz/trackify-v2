import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

const patchSchema = z.object({
  aiTargetHoursPer100Czk: z.number().positive().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { aiTargetHoursPer100Czk: true },
    });
    return NextResponse.json({
      aiTargetHoursPer100Czk: row?.aiTargetHoursPer100Czk ?? null,
    });
  } catch (error) {
    console.error("GET /api/ai-subscriptions/settings:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = patchSchema.parse(body);

    const next =
      parsed.aiTargetHoursPer100Czk === undefined
        ? undefined
        : parsed.aiTargetHoursPer100Czk;

    const row = await prisma.user.update({
      where: { id: user.id },
      data:
        next === undefined
          ? {}
          : { aiTargetHoursPer100Czk: next },
      select: { aiTargetHoursPer100Czk: true },
    });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    console.error("PATCH /api/ai-subscriptions/settings:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
