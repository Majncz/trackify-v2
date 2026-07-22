import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  providerKey: z.string().max(64).optional().nullable(),
  sortOrder: z.number().int().optional(),
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

    const existing = await prisma.aiSubscriptionPreset.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing.isBuiltIn) {
      return NextResponse.json(
        { error: "Built-in presets cannot be edited" },
        { status: 403 }
      );
    }

    const row = await prisma.aiSubscriptionPreset.update({
      where: { id },
      data: {
        ...(parsed.name != null ? { name: parsed.name.trim() } : {}),
        ...(parsed.providerKey !== undefined
          ? { providerKey: parsed.providerKey?.trim() || null }
          : {}),
        ...(parsed.sortOrder != null ? { sortOrder: parsed.sortOrder } : {}),
      },
    });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    console.error("PATCH /api/ai-subscriptions/presets/[id]:", error);
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
    const existing = await prisma.aiSubscriptionPreset.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing.isBuiltIn) {
      return NextResponse.json(
        { error: "Built-in presets cannot be deleted" },
        { status: 403 }
      );
    }

    await prisma.aiSubscriptionPreset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/ai-subscriptions/presets/[id]:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
