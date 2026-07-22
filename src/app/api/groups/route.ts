import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a #RRGGBB hex value")
  .nullable()
  .optional();

const groupSchema = z.object({
  name: z.string().min(1).max(100),
  taskIds: z.array(z.string()),
  color: hexColorSchema,
});

const groupInclude = {
  tasks: { select: { id: true } },
} satisfies Prisma.TaskGroupInclude;

type LoadedGroup = Prisma.TaskGroupGetPayload<{ include: typeof groupInclude }>;

function serializeGroup(g: LoadedGroup) {
  const { tasks, ...rest } = g;
  return {
    ...rest,
    taskIds: tasks.map((t) => t.id),
  };
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groups = await prisma.taskGroup.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: groupInclude,
  });

  return NextResponse.json(groups.map(serializeGroup));
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { name, taskIds, color } = groupSchema.parse(body);

    try {
      const group = await prisma.$transaction(async (tx) => {
        const tasks = await tx.task.findMany({
          where: { id: { in: taskIds }, userId: user.id },
          select: { id: true, taskGroupId: true },
        });

        if (tasks.length !== taskIds.length) {
          const err = new Error("TASK_NOT_FOUND");
          throw err;
        }

        if (tasks.some((t) => t.taskGroupId != null)) {
          const err = new Error("TASK_IN_GROUP");
          throw err;
        }

        const created = await tx.taskGroup.create({
          data: {
            name,
            userId: user.id,
            color: color ?? null,
          },
        });

        if (taskIds.length > 0) {
          await tx.task.updateMany({
            where: { id: { in: taskIds }, userId: user.id },
            data: { taskGroupId: created.id },
          });
        }

        return tx.taskGroup.findUniqueOrThrow({
          where: { id: created.id },
          include: groupInclude,
        });
      });

      return NextResponse.json(serializeGroup(group), { status: 201 });
    } catch (e) {
      if (e instanceof Error && e.message === "TASK_NOT_FOUND") {
        return NextResponse.json(
          { error: "One or more tasks were not found" },
          { status: 400 }
        );
      }
      if (e instanceof Error && e.message === "TASK_IN_GROUP") {
        return NextResponse.json(
          {
            error:
              "One or more tasks already belong to a group. Each task can only be in one group.",
          },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    console.error("Create group error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
