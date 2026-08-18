import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
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
      select: { email: true, displayName: true },
    });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update name" }, { status: 500 });
  }
}
