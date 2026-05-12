import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enrichAiSubscriptionPeriods } from "@/lib/ai-subscription-enrich";
import {
  ensureBuiltInAiPresets,
  validateAiBillingDepletedAt,
} from "@/lib/ai-subscription-metrics";
import { optionalBillingEmailSchema } from "@/lib/ai-subscription-email-schema";
import { optionalBillingProviderUrlSchema } from "@/lib/ai-subscription-provider-url-schema";
import {
  AI_BILLING_CADENCE_DEFAULT,
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

const createPeriodSchema = z.object({
  name: z.string().min(1).max(200),
  price: z.number().positive(),
  currency: z.string().min(1).max(12).default("CZK"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  depletedAt: z.union([z.string().datetime(), z.null()]).optional(),
  billingKind: aiBillingKindZod.optional().default("purchase"),
  billingCadence: aiBillingCadenceZod
    .optional()
    .default(AI_BILLING_CADENCE_DEFAULT),
  presetId: z.string().uuid().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  billingEmail: optionalBillingEmailSchema,
  billingProviderUrl: optionalBillingProviderUrlSchema,
  saveAsPreset: z
    .object({
      name: z.string().min(1).max(120),
      providerKey: z.string().max(64).optional().nullable(),
    })
    .optional(),
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureBuiltInAiPresets(prisma, user.id);
    const periods = await enrichAiSubscriptionPeriods(prisma, user.id);
    return NextResponse.json({ periods });
  } catch (error) {
    console.error("GET /api/ai-subscriptions/periods:", error);
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

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureBuiltInAiPresets(prisma, user.id);
    const body = await request.json();
    const parsed = createPeriodSchema.parse(body);

    const startsAt = new Date(parsed.startsAt);
    const endsAt = parsed.endsAt ? new Date(parsed.endsAt) : null;
    if (Number.isNaN(startsAt.getTime())) {
      return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });
    }
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      return NextResponse.json({ error: "Invalid endsAt" }, { status: 400 });
    }
    if (endsAt && endsAt.getTime() < startsAt.getTime()) {
      return NextResponse.json(
        { error: "endsAt must be on or after startsAt" },
        { status: 400 }
      );
    }

    const depletedAt =
      parsed.depletedAt === undefined || parsed.depletedAt === null
        ? null
        : new Date(parsed.depletedAt);
    if (depletedAt && Number.isNaN(depletedAt.getTime())) {
      return NextResponse.json({ error: "Invalid depletedAt" }, { status: 400 });
    }

    const depletedErr = validateAiBillingDepletedAt({
      startsAt,
      calendarEndsAt: endsAt,
      depletedAt,
    });
    if (depletedErr) {
      return NextResponse.json({ error: depletedErr }, { status: 400 });
    }

    if (parsed.presetId) {
      const preset = await prisma.aiSubscriptionPreset.findFirst({
        where: { id: parsed.presetId, userId: user.id },
      });
      if (!preset) {
        return NextResponse.json({ error: "Preset not found" }, { status: 404 });
      }
    }

    let presetId: string | null = parsed.presetId ?? null;

    if (parsed.saveAsPreset) {
      const maxSort = await prisma.aiSubscriptionPreset.aggregate({
        where: { userId: user.id },
        _max: { sortOrder: true },
      });
      const preset = await prisma.aiSubscriptionPreset.create({
        data: {
          userId: user.id,
          name: parsed.saveAsPreset.name.trim(),
          providerKey: parsed.saveAsPreset.providerKey?.trim() || null,
          isBuiltIn: false,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        },
      });
      presetId = preset.id;
    }

    const row = await prisma.aiSubscriptionPeriod.create({
      data: {
        userId: user.id,
        name: parsed.name.trim(),
        price: parsed.price,
        currency: parsed.currency.trim().toUpperCase().slice(0, 12),
        startsAt,
        endsAt,
        depletedAt,
        note: parsed.note?.trim() || null,
        presetId,
        billingKind: parsed.billingKind,
        billingCadence: normalizeAiBillingCadence(parsed.billingCadence),
        billingEmail: parsed.billingEmail ?? null,
        billingProviderUrl: parsed.billingProviderUrl ?? null,
      },
    });

    const enriched = await enrichAiSubscriptionPeriods(prisma, user.id);
    const one = enriched.find((p) => p.id === row.id);
    return NextResponse.json({ period: one ?? row }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    console.error("POST /api/ai-subscriptions/periods:", error);
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
