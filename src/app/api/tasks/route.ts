import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const taskSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const showHidden = searchParams.get("hidden") === "true";

  const tasks = await prisma.task.findMany({
    where: { 
      userId: user.id,
      hidden: showHidden,
    },
    include: {
      events: {
        orderBy: { from: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name } = taskSchema.parse(body);

    const task = await prisma.task.create({
      data: {
        name,
        userId: user.id,
      },
      include: {
        events: true,
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      );
    }
    console.error("Create task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
