import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const roundingValues = [0, 15, 30, 60] as const;

const patchSchema = z
  .object({
    hourlyRate: z.number().nonnegative().optional(),
    currency: z.string().min(1).max(12).optional(),
    roundingMins: z
      .number()
      .int()
      .refine((v) => (roundingValues as readonly number[]).includes(v), {
        message: "roundingMins must be 0, 15, 30, or 60",
      })
      .optional(),
    minSessionMins: z.number().int().min(0).max(24 * 60).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    const existing = await prisma.billingTask.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = await prisma.billingTask.update({
      where: { id },
      data,
      include: {
        task: {
          select: {
            id: true,
            name: true,
            hidden: true,
            taskGroup: { select: { id: true, name: true, color: true } },
          },
        },
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
    console.error("PATCH /api/billing/tasks/[id]:", error);
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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.billingTask.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.billingTask.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/billing/tasks/[id]:", error);
    const detail = devErrorDetail(error);
    return NextResponse.json(
      { error: "Internal server error", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
