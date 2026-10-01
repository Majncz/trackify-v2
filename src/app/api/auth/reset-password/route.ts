import { NextResponse } from "next/server";
import { clientIp, rateHit, rateLimited, tooManyResponseBody } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();
    const ip = clientIp(request.headers);
    if (rateLimited(`reset:${ip}`, 10, 15 * 60 * 1000)) {
      return NextResponse.json(tooManyResponseBody(), { status: 429 });
    }
    rateHit(`reset:${ip}`, 15 * 60 * 1000);

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    // Find valid reset token
    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetRecord) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
    }

    if (resetRecord.expiresAt < new Date()) {
      // Delete expired token
      await prisma.passwordReset.delete({ where: { id: resetRecord.id } });
      return NextResponse.json({ error: "Reset link has expired" }, { status: 400 });
    }

    // Hash new password and update user (using 12 rounds to match registration)
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: resetRecord.userId },
      data: { password: hashedPassword },
    });

    // Delete the used token
    await prisma.passwordReset.delete({ where: { id: resetRecord.id } });

    return NextResponse.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Password reset error:", error);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}
