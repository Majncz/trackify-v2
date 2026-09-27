import { NextResponse } from "next/server";
import { clientIp, rateHit, rateLimited } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Quietly stop sending after a few requests (same reply, so no account probing).
    const ip = clientIp(request.headers);
    const emailKey = `forgot:${String(email).toLowerCase()}`;
    if (rateLimited(`forgotip:${ip}`, 5, 60 * 60 * 1000) || rateLimited(emailKey, 3, 60 * 60 * 1000)) {
      return NextResponse.json({ message: "If an account exists, a reset email has been sent" });
    }
    rateHit(`forgotip:${ip}`, 60 * 60 * 1000);
    rateHit(emailKey, 60 * 60 * 1000);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ message: "If an account exists, a reset email has been sent" });
    }

    // Delete any existing reset tokens for this user
    await prisma.passwordReset.deleteMany({
      where: { userId: user.id },
    });

    // Create new reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordReset.create({
      data: {
        token,
        expiresAt,
        userId: user.id,
      },
    });

    // Send email
    await sendPasswordResetEmail(email, token);

    return NextResponse.json({ message: "If an account exists, a reset email has been sent" });
  } catch (error) {
    console.error("Password reset error:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
