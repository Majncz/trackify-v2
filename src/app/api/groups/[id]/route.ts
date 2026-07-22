import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  taskIds: z.array(z.string()).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a #RRGGBB hex value")
    .nullable()
    .optional(),
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await prisma.taskGroup.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    try {
      const group = await prisma.$transaction(async (tx) => {
        if (data.name !== undefined || data.color !== undefined) {
          await tx.taskGroup.update({
            where: { id },
            data: {
              ...(data.name !== undefined && { name: data.name }),
              ...(data.color !== undefined && { color: data.color }),
            },
          });
        }

        if (data.taskIds !== undefined) {
          await tx.task.updateMany({
            where: { taskGroupId: id },
            data: { taskGroupId: null },
          });

          if (data.taskIds.length > 0) {
            const tasks = await tx.task.findMany({
              where: { id: { in: data.taskIds }, userId: user.id },
              select: { id: true, taskGroupId: true },
            });

            if (tasks.length !== data.taskIds.length) {
              const err = new Error("TASK_NOT_FOUND");
              throw err;
            }

            if (tasks.some((t) => t.taskGroupId != null)) {
              const err = new Error("TASK_IN_GROUP");
              throw err;
            }

            await tx.task.updateMany({
              where: { id: { in: data.taskIds } },
              data: { taskGroupId: id },
            });
          }
        }

        return tx.taskGroup.findUniqueOrThrow({
          where: { id },
          include: groupInclude,
        });
      });

      return NextResponse.json(serializeGroup(group));
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
              "One or more tasks already belong to another group. Each task can only be in one group.",
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
    console.error("Update group error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await prisma.taskGroup.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.taskGroup.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
