import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enrichAiSubscriptionPeriods } from "@/lib/ai-subscription-enrich";
import { validateAiBillingDepletedAt } from "@/lib/ai-subscription-metrics";
import { optionalBillingEmailSchema } from "@/lib/ai-subscription-email-schema";
import { optionalBillingProviderUrlSchema } from "@/lib/ai-subscription-provider-url-schema";
import {
  aiBillingCadenceZod,
  normalizeAiBillingCadence,
} from "@/lib/ai-subscription-cadence";
import { prismaKnownRequestUserMessage } from "@/lib/prisma-client-errors";
import { z } from "zod";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

const aiBillingKindZod = z.enum(["purchase", "recurring_monthly"]);

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  price: z.number().positive().optional(),
  currency: z.string().min(1).max(12).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional().nullable(),
  depletedAt: z.union([z.string().datetime(), z.null()]).optional(),
  billingKind: aiBillingKindZod.optional(),
  billingCadence: aiBillingCadenceZod.optional(),
  presetId: z.string().uuid().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  billingEmail: optionalBillingEmailSchema,
  billingProviderUrl: optionalBillingProviderUrlSchema,
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

    let nextDepleted: Date | null | undefined = undefined;
    if (parsed.depletedAt !== undefined) {
      nextDepleted =
        parsed.depletedAt === null ? null : new Date(parsed.depletedAt);
      if (nextDepleted != null && Number.isNaN(nextDepleted.getTime())) {
        return NextResponse.json({ error: "Invalid depletedAt" }, { status: 400 });
      }
    }

    const mergedDepleted =
      nextDepleted !== undefined ? nextDepleted : existing.depletedAt;

    const mergedBillingCadence = normalizeAiBillingCadence(
      parsed.billingCadence !== undefined
        ? parsed.billingCadence
        : existing.billingCadence
    );

    if (nextEnd && nextEnd.getTime() < nextStart.getTime()) {
      return NextResponse.json(
        { error: "endsAt must be on or after startsAt" },
        { status: 400 }
      );
    }

    const depletedErr = validateAiBillingDepletedAt({
      startsAt: nextStart,
      calendarEndsAt: nextEnd,
      depletedAt: mergedDepleted,
    });
    if (depletedErr) {
      return NextResponse.json({ error: depletedErr }, { status: 400 });
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
        ...(nextDepleted !== undefined ? { depletedAt: nextDepleted } : {}),
        ...(parsed.billingKind !== undefined
          ? { billingKind: parsed.billingKind }
          : {}),
        billingCadence: mergedBillingCadence,
        ...(parsed.billingEmail !== undefined
          ? { billingEmail: parsed.billingEmail }
          : {}),
        ...(parsed.billingProviderUrl !== undefined
          ? { billingProviderUrl: parsed.billingProviderUrl }
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
    const prismaMsg = prismaKnownRequestUserMessage(error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      {
        error: prismaMsg ?? "Internal server error",
        ...(detail ? { detail } : {}),
      },
      { status: prismaMsg ? 503 : 500 }
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
    const prismaMsg = prismaKnownRequestUserMessage(error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      {
        error: prismaMsg ?? "Internal server error",
        ...(detail ? { detail } : {}),
      },
      { status: prismaMsg ? 503 : 500 }
    );
  }
}
