import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enrichAiSubscriptionPeriods } from "@/lib/ai-subscription-enrich";
import { z } from "zod";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  price: z.number().positive().optional(),
  currency: z.string().min(1).max(12).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional().nullable(),
  presetId: z.string().uuid().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id } = await params;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = patchSchema.parse(body);

    const existing = await prisma.aiSubscriptionPeriod.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (parsed.presetId) {
      const preset = await prisma.aiSubscriptionPreset.findFirst({
        where: { id: parsed.presetId, userId: user.id },
      });
      if (!preset) {
        return NextResponse.json({ error: "Preset not found" }, { status: 404 });
      }
    }

    const startsAt = parsed.startsAt ? new Date(parsed.startsAt) : undefined;
    const endsAt =
      parsed.endsAt === undefined
        ? undefined
        : parsed.endsAt
          ? new Date(parsed.endsAt)
          : null;

    if (startsAt && Number.isNaN(startsAt.getTime())) {
      return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });
    }
    if (
      endsAt &&
      endsAt !== null &&
      Number.isNaN(endsAt.getTime())
    ) {
      return NextResponse.json({ error: "Invalid endsAt" }, { status: 400 });
    }

    const nextStart = startsAt ?? existing.startsAt;
    const nextEnd =
      endsAt !== undefined ? endsAt : existing.endsAt;
    if (nextEnd && nextEnd.getTime() < nextStart.getTime()) {
      return NextResponse.json(
        { error: "endsAt must be on or after startsAt" },
        { status: 400 }
      );
    }

    await prisma.aiSubscriptionPeriod.update({
      where: { id },
      data: {
        ...(parsed.name != null ? { name: parsed.name.trim() } : {}),
        ...(parsed.price != null ? { price: parsed.price } : {}),
        ...(parsed.currency != null
          ? { currency: parsed.currency.trim().toUpperCase().slice(0, 12) }
          : {}),
        ...(startsAt != null ? { startsAt } : {}),
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(parsed.presetId !== undefined ? { presetId: parsed.presetId } : {}),
        ...(parsed.note !== undefined
          ? { note: parsed.note?.trim() || null }
          : {}),
      },
    });

    const enriched = await enrichAiSubscriptionPeriods(prisma, user.id);
    const one = enriched.find((p) => p.id === id);
    return NextResponse.json({ period: one });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    console.error("PATCH /api/ai-subscriptions/periods/[id]:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const { id } = await params;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const existing = await prisma.aiSubscriptionPeriod.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.aiSubscriptionPeriod.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/ai-subscriptions/periods/[id]:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
