import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

/** POST /api/profile/password — change password while signed in. */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { currentPassword, newPassword } = schema.parse(await request.json());
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    if (!(await verifyPassword(currentPassword, row?.password))) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(newPassword, 12) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    console.error("Change password error:", error);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
