import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const { toolName, args } = await req.json();

  try {
    let result;

    switch (toolName) {
      case "createTask": {
        const { name } = args;
        const task = await prisma.task.create({
          data: { name, userId },
        });
        result = { 
          success: true, 
          message: `Created task "${task.name}"`,
          task: { name: task.name } 
        };
        break;
      }

      case "createEvent": {
        const { taskId, duration, name, createdAt } = args;
        const task = await prisma.task.findFirst({
          where: { id: taskId, userId },
        });

        if (!task) {
          result = { success: false, error: "Task not found" };
          break;
        }

        const event = await prisma.event.create({
          data: {
            taskId,
            name: name || "Time entry",
            duration,
            ...(createdAt && { createdAt: new Date(createdAt) }),
          },
        });

        const hours = Math.floor(duration / 3600000);
        const minutes = Math.floor((duration % 3600000) / 60000);
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const dateStr = event.createdAt.toLocaleDateString("en-US", { 
          weekday: "short", month: "short", day: "numeric" 
        });

        result = {
          success: true,
          message: `Logged ${durationStr} to "${task.name}" on ${dateStr}`,
          event: {
            taskName: task.name,
            duration: durationStr,
            date: dateStr,
          },
        };
        break;
      }

      case "deleteEvent": {
        const { eventId } = args;
        const event = await prisma.event.findFirst({
          where: { id: eventId, task: { userId } },
          include: { task: { select: { name: true } } },
        });

        if (!event) {
          result = { success: false, error: "Event not found" };
          break;
        }

        const hours = Math.floor(event.duration / 3600000);
        const minutes = Math.floor((event.duration % 3600000) / 60000);
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const dateStr = event.createdAt.toLocaleDateString("en-US", { 
          weekday: "short", month: "short", day: "numeric" 
        });

        await prisma.event.delete({ where: { id: eventId } });
        result = {
          success: true,
          message: `Deleted ${durationStr} entry from "${event.task.name}" (${dateStr})`,
        };
        break;
      }

      default:
        return Response.json({ error: "Unknown tool" }, { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("Tool execution error:", error);
    return Response.json({ error: "Tool execution failed" }, { status: 500 });
  }
}
