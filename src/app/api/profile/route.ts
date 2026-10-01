import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { persistTimerStop } from "@/lib/timer-runtime";
import { z } from "zod";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
});

const deleteSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, displayName: true },
  });

  return NextResponse.json({
    id: user.id,
    email: row?.email ?? user.email,
    displayName: row?.displayName ?? "",
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { displayName } = updateSchema.parse(body);
    const row = await prisma.user.update({
      where: { id: user.id },
      data: { displayName },
      select: { id: true, email: true, displayName: true },
    });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update name" }, { status: 500 });
  }
}

/** DELETE /api/profile {password} — permanently delete the account and all its data. */
export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { password } = deleteSchema.parse(await request.json());
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    if (!(await verifyPassword(password, row?.password))) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 403 });
    }
    await persistTimerStop(user.id);
    await prisma.user.delete({ where: { id: user.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    console.error("Delete account error:", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
