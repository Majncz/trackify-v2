import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { randomBytes } from "crypto";
import { getAuthUser } from "@/lib/api-auth";

const tokenRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

/**
 * POST /api/auth/token
 * Authenticate user and create an API token for mobile app
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = tokenRequestSchema.parse(body);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Validate password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Generate secure token (32 bytes = 64 hex characters)
    const token = randomBytes(32).toString("hex");

    // Create token with 30-day expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const apiToken = await prisma.apiToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    return NextResponse.json({
      token: apiToken.token,
      expiresAt: apiToken.expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      );
    }
    console.error("Token creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/token
 * Revoke the current API token (logout for mobile app)
 */
export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get token from Authorization header
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Bearer token required" },
      { status: 400 }
    );
  }

  const token = authHeader.slice(7);

  // Delete the token
  await prisma.apiToken.deleteMany({
    where: {
      token,
      userId: user.id,
    },
  });

  return NextResponse.json({ success: true });
}
