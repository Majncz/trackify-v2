import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, zodSchema } from "ai";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic("claude-opus-4-20250514"),
    system: `You are an AI assistant for Trackify, a time tracking application.
Your job is to help users manage their time entries and tasks through natural language.

Today's date is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.
Current time is ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}.

When users want to log time:
- Parse natural language like "yesterday afternoon for 3 hours" or "last Monday 9am-12pm"
- Always confirm what you understood before creating events
- Duration should be in milliseconds for the API

When creating events:
- First use findTask to match the task name (fuzzy matching)
- If no match, suggest creating a new task first
- Be helpful and conversational

Keep responses concise and friendly.`,
    messages,
    tools: {
      listTasks: tool({
        description: "Get all tasks for the current user",
        inputSchema: zodSchema(z.object({})),
        execute: async () => {
          const tasks = await prisma.task.findMany({
            where: { userId, hidden: false },
            include: {
              events: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
            orderBy: { name: "asc" },
          });

          return tasks.map((t) => ({
            id: t.id,
            name: t.name,
            totalTime: t.events.reduce((sum, e) => sum + e.duration, 0),
            lastActivity: t.events[0]?.createdAt || null,
          }));
        },
      }),

      findTask: tool({
        description:
          "Find a task by name (fuzzy matching). Use this before creating events to get the task ID.",
        inputSchema: zodSchema(
          z.object({
            query: z
              .string()
              .describe("The task name to search for (partial match OK)"),
          })
        ),
        execute: async ({ query }) => {
          const tasks = await prisma.task.findMany({
            where: {
              userId,
              hidden: false,
              name: { contains: query, mode: "insensitive" },
            },
            select: { id: true, name: true },
          });

          if (tasks.length === 0) {
            // Try broader search
            const allTasks = await prisma.task.findMany({
              where: { userId, hidden: false },
              select: { id: true, name: true },
            });

            // Simple fuzzy match - find tasks where query words appear
            const queryWords = query.toLowerCase().split(/\s+/);
            const matches = allTasks.filter((t) =>
              queryWords.some((word) => t.name.toLowerCase().includes(word))
            );

            return matches.length > 0
              ? { found: true, tasks: matches }
              : {
                  found: false,
                  message: `No task matching "${query}" found`,
                  availableTasks: allTasks.map((t) => t.name),
                };
          }

          return { found: true, tasks };
        },
      }),

      createTask: tool({
        description: "Create a new task",
        inputSchema: zodSchema(
          z.object({
            name: z.string().describe("Name of the new task"),
          })
        ),
        execute: async ({ name }) => {
          const task = await prisma.task.create({
            data: { name, userId },
          });

          return { success: true, task: { id: task.id, name: task.name } };
        },
      }),

      createEvent: tool({
        description:
          "Create a time entry for a task. Use findTask first to get the taskId.",
        inputSchema: zodSchema(
          z.object({
            taskId: z.string().uuid().describe("The task ID to log time to"),
            duration: z
              .number()
              .positive()
              .describe("Duration in milliseconds"),
            name: z
              .string()
              .optional()
              .describe("Optional description for this time entry"),
            createdAt: z
              .string()
              .optional()
              .describe(
                "ISO timestamp for when this event occurred (defaults to now)"
              ),
          })
        ),
        execute: async ({ taskId, duration, name, createdAt }) => {
          // Verify task belongs to user
          const task = await prisma.task.findFirst({
            where: { id: taskId, userId },
          });

          if (!task) {
            return { success: false, error: "Task not found" };
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
          const durationStr =
            hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          return {
            success: true,
            event: {
              id: event.id,
              taskName: task.name,
              duration: durationStr,
              createdAt: event.createdAt,
            },
          };
        },
      }),

      createMultipleEvents: tool({
        description:
          "Create multiple time entries at once. Use findTask first for each task.",
        inputSchema: zodSchema(
          z.object({
            events: z.array(
              z.object({
                taskId: z.string().uuid(),
                duration: z
                  .number()
                  .positive()
                  .describe("Duration in milliseconds"),
                name: z.string().optional(),
                createdAt: z.string().optional(),
              })
            ),
          })
        ),
        execute: async ({ events }) => {
          const results = [];

          for (const e of events) {
            const task = await prisma.task.findFirst({
              where: { id: e.taskId, userId },
            });

            if (!task) {
              results.push({
                success: false,
                error: `Task ${e.taskId} not found`,
              });
              continue;
            }

            const event = await prisma.event.create({
              data: {
                taskId: e.taskId,
                name: e.name || "Time entry",
                duration: e.duration,
                ...(e.createdAt && { createdAt: new Date(e.createdAt) }),
              },
            });

            const hours = Math.floor(e.duration / 3600000);
            const minutes = Math.floor((e.duration % 3600000) / 60000);
            const durationStr =
              hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

            results.push({
              success: true,
              taskName: task.name,
              duration: durationStr,
              createdAt: event.createdAt,
            });
          }

          return { results };
        },
      }),

      getStats: tool({
        description: "Get time tracking statistics for a period",
        inputSchema: zodSchema(
          z.object({
            period: z
              .enum(["today", "week", "month", "all"])
              .describe("Time period to get stats for"),
          })
        ),
        execute: async ({ period }) => {
          const now = new Date();
          let startDate: Date;

          switch (period) {
            case "today":
              startDate = new Date(now.setHours(0, 0, 0, 0));
              break;
            case "week": {
              const dayOfWeek = now.getDay();
              const diff =
                now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
              startDate = new Date(now.setDate(diff));
              startDate.setHours(0, 0, 0, 0);
              break;
            }
            case "month":
              startDate = new Date(now.getFullYear(), now.getMonth(), 1);
              break;
            case "all":
              startDate = new Date(0);
              break;
          }

          const tasks = await prisma.task.findMany({
            where: { userId, hidden: false },
            include: {
              events: {
                where: { createdAt: { gte: startDate } },
              },
            },
          });

          const taskStats = tasks
            .map((t) => ({
              name: t.name,
              totalMs: t.events.reduce((sum, e) => sum + e.duration, 0),
            }))
            .filter((t) => t.totalMs > 0)
            .sort((a, b) => b.totalMs - a.totalMs);

          const totalMs = taskStats.reduce((sum, t) => sum + t.totalMs, 0);
          const totalHours = Math.floor(totalMs / 3600000);
          const totalMinutes = Math.floor((totalMs % 3600000) / 60000);

          return {
            period,
            totalTime: `${totalHours}h ${totalMinutes}m`,
            taskBreakdown: taskStats.map((t) => ({
              name: t.name,
              time: `${Math.floor(t.totalMs / 3600000)}h ${Math.floor((t.totalMs % 3600000) / 60000)}m`,
            })),
          };
        },
      }),

      deleteEvent: tool({
        description: "Delete a time entry by ID",
        inputSchema: zodSchema(
          z.object({
            eventId: z.string().uuid().describe("The event ID to delete"),
          })
        ),
        execute: async ({ eventId }) => {
          const event = await prisma.event.findFirst({
            where: { id: eventId, task: { userId } },
            include: { task: { select: { name: true } } },
          });

          if (!event) {
            return { success: false, error: "Event not found" };
          }

          await prisma.event.delete({ where: { id: eventId } });

          return {
            success: true,
            message: `Deleted time entry from ${event.task.name}`,
          };
        },
      }),
    },
  });

  return result.toTextStreamResponse();
}
