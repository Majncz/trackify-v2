import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const groupSchema = z.object({
  name: z.string().min(1).max(100),
  taskIds: z.array(z.string()),
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groups = await prisma.taskGroup.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    groups.map((g) => ({ ...g, taskIds: JSON.parse(g.taskIds) as string[] }))
  );
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { name, taskIds } = groupSchema.parse(body);

    const group = await prisma.taskGroup.create({
      data: { name, taskIds: JSON.stringify(taskIds), userId: user.id },
    });

    return NextResponse.json(
      { ...group, taskIds: JSON.parse(group.taskIds) as string[] },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    console.error("Create group error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
