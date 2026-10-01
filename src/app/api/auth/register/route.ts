import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateHit, rateLimited, tooManyResponseBody } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email("Invalid email address")),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = registerSchema.parse(body);
    const ip = clientIp(request.headers);
    if (rateLimited(`register:${ip}`, 10, 60 * 60 * 1000)) {
      return NextResponse.json(tooManyResponseBody(), { status: 429 });
    }
    rateHit(`register:${ip}`, 60 * 60 * 1000);

    const exists = await prisma.user.findUnique({
      where: { email },
    });

    if (exists) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    return NextResponse.json({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      );
    }
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
