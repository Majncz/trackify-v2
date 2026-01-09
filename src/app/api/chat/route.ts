import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, stepCountIs, convertToModelMessages } from "ai";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

// Helper to format milliseconds to readable string
function formatDuration(ms: number): string {
  if (ms === 0) return "0m";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

// Helper to format date to readable string
function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleDateString("en-US", { 
    month: "short", 
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined 
  });
}

// Create tool definitions with execute functions
function createTools(userId: string) {
  return {
    listTasks: tool({
      description: "Get all tasks with their all-time total hours and last activity date. For time-filtered statistics, use getStats instead.",
      inputSchema: z.object({}),
      execute: async () => {
        const tasks = await prisma.task.findMany({
          where: { userId, hidden: false },
          include: { events: true },
          orderBy: { name: "asc" },
        });

        return tasks.map((t) => {
          const totalMs = t.events.reduce((sum, e) => sum + e.duration, 0);
          const lastEvent = t.events.sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
          
          return {
            id: t.id,
            name: t.name,
            totalTime: formatDuration(totalMs),
            lastActivity: formatDate(lastEvent?.createdAt || null),
          };
        });
      },
    }),

    findTask: tool({
      description: "Find a task by name (fuzzy matching). Use this before creating events to get the task ID.",
      inputSchema: z.object({
        query: z.string().describe("The task name to search for (partial match OK)"),
      }),
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
          const allTasks = await prisma.task.findMany({
            where: { userId, hidden: false },
            select: { id: true, name: true },
          });

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

    listEvents: tool({
      description: "List time entries (events) for a task with smart filtering. Use this to find specific events to delete or review.",
      inputSchema: z.object({
        taskId: z.string().optional().describe("Filter by task ID. Use findTask first to get the ID."),
        taskName: z.string().optional().describe("Filter by task name (partial match). Alternative to taskId."),
        limit: z.number().optional().describe("Max number of events to return (default: 10, max: 50)"),
        startDate: z.string().optional().describe("Filter events from this date (ISO format)"),
        endDate: z.string().optional().describe("Filter events until this date (ISO format)"),
        orderBy: z.enum(["newest", "oldest"]).optional().describe("Sort order (default: newest first)"),
      }),
      execute: async ({ taskId, taskName, limit = 10, startDate, endDate, orderBy = "newest" }) => {
        const maxLimit = Math.min(limit, 50);
        
        // Build task filter
        let taskFilter: { id?: string; name?: { contains: string; mode: "insensitive" } } | undefined;
        if (taskId) {
          taskFilter = { id: taskId };
        } else if (taskName) {
          taskFilter = { name: { contains: taskName, mode: "insensitive" } };
        }

        // Build date filter
        const dateFilter: { gte?: Date; lte?: Date } = {};
        if (startDate) dateFilter.gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          dateFilter.lte = end;
        }

        const events = await prisma.event.findMany({
          where: {
            task: {
              userId,
              hidden: false,
              ...taskFilter,
            },
            ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
          },
          include: {
            task: { select: { name: true } },
          },
          orderBy: { createdAt: orderBy === "newest" ? "desc" : "asc" },
          take: maxLimit,
        });

        return {
          count: events.length,
          events: events.map((e) => ({
            id: e.id,
            taskName: e.task.name,
            duration: formatDuration(e.duration),
            durationMs: e.duration,
            name: e.name || null,
            date: e.createdAt.toISOString().split("T")[0],
            time: e.createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          })),
        };
      },
    }),

    // Write tools - NO execute function = requires user approval
    createTask: tool({
      description: "Create a new task",
      inputSchema: z.object({
        name: z.string().describe("Name of the new task"),
      }),
      // No execute - requires approval
    }),

    createEvent: tool({
      description: "Create a time entry for a task. Use findTask first to get the taskId and taskName.",
      inputSchema: z.object({
        taskId: z.string().describe("The task ID to log time to"),
        taskName: z.string().describe("The task name (for display to user)"),
        duration: z.number().describe("Duration in milliseconds"),
        name: z.string().optional().describe("Optional description for this time entry"),
        createdAt: z.string().optional().describe("ISO timestamp for when this event occurred (defaults to now)"),
      }),
      // No execute - requires approval
    }),

    getStats: tool({
      description: "Get time tracking statistics for any time period. Use presets OR custom date range.",
      inputSchema: z.object({
        period: z.enum(["today", "week", "month", "year", "all"]).optional()
          .describe("Preset periods: 'today', 'week' (this week), 'month' (this month), 'year' (this year), 'all' (all-time)"),
        startDate: z.string().optional()
          .describe("Custom start date in ISO format (e.g., '2025-01-01'). Use for specific ranges like 'last year', 'Q3 2024', etc."),
        endDate: z.string().optional()
          .describe("Custom end date in ISO format (e.g., '2025-12-31'). Defaults to now if not specified."),
      }),
      execute: async ({ period, startDate: startDateStr, endDate: endDateStr }) => {
        let startDate: Date;
        let endDate: Date = new Date();
        let periodLabel: string;

        const now = new Date();
        
        // If custom dates provided, use them
        if (startDateStr) {
          startDate = new Date(startDateStr);
          if (endDateStr) {
            endDate = new Date(endDateStr);
            // Set to end of day
            endDate.setHours(23, 59, 59, 999);
          }
          
          // Generate period label from dates
          const startYear = startDate.getFullYear();
          const endYear = endDate.getFullYear();
          const startMonth = startDate.toLocaleString("en-US", { month: "short" });
          const endMonth = endDate.toLocaleString("en-US", { month: "short" });
          
          if (startYear === endYear && startDate.getMonth() === 0 && startDate.getDate() === 1 && 
              endDate.getMonth() === 11 && endDate.getDate() === 31) {
            // Full year
            periodLabel = `${startYear}`;
          } else if (startYear === endYear) {
            periodLabel = `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}, ${startYear}`;
          } else {
            periodLabel = `${startMonth} ${startDate.getDate()}, ${startYear} - ${endMonth} ${endDate.getDate()}, ${endYear}`;
          }
        } else {
          // Use preset period
          const p = period || "all";
          periodLabel = p;
          
          switch (p) {
            case "today":
              startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              break;
            case "week": {
              const dayOfWeek = now.getDay();
              const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
              startDate = new Date(now.getFullYear(), now.getMonth(), diff);
              break;
            }
            case "month":
              startDate = new Date(now.getFullYear(), now.getMonth(), 1);
              periodLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
              break;
            case "year":
              startDate = new Date(now.getFullYear(), 0, 1);
              periodLabel = `${now.getFullYear()}`;
              break;
            case "all":
            default:
              startDate = new Date(0);
              periodLabel = "all-time";
              break;
          }
        }

        const tasks = await prisma.task.findMany({
          where: { userId, hidden: false },
          include: {
            events: {
              where: { 
                createdAt: { 
                  gte: startDate,
                  lte: endDate,
                } 
              },
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
          period: periodLabel,
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
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
      inputSchema: z.object({
        eventId: z.string().describe("The event ID to delete"),
      }),
      // No execute - requires approval
    }),
  };
}

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const body = await req.json();
  const { messages, conversationId } = body;

  const conversation = conversationId ? await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  }) : null;

  // Create conversation if it doesn't exist
  if (!conversation && conversationId) {
    return new Response("Conversation not found", { status: 404 });
  }

  // Get the last message - only save if it's actually a user message
  const lastMessage = messages[messages.length - 1];
  const isUserMessage = lastMessage?.role === "user";
  const userMessageText = isUserMessage 
    ? (lastMessage?.parts?.find((p: { type: string }) => p.type === "text")?.text || lastMessage?.content || "")
    : "";

  // Save user message to DB if conversation exists and last message is from user
  if (conversation && isUserMessage && userMessageText) {
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: userMessageText,
        parts: lastMessage.parts || null,
      },
    });

    // Update conversation title from first user message if not set
    if (!conversation.title && userMessageText) {
      const title = userMessageText.slice(0, 30).trim();
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { title, updatedAt: new Date() },
      });
    } else {
      // Just update timestamp
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
    }
  }

  // Create tools with execute functions
  const tools = createTools(userId);

  // Convert UI messages to model messages format
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `You are an AI assistant for Trackify, a time tracking application.

Today: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.
Current year: ${new Date().getFullYear()}.

**Using getStats for time statistics:**
Use presets for common periods:
- "today" → period: "today"
- "this week" → period: "week"
- "this month" → period: "month"  
- "this year" → period: "year"
- "all time" → period: "all"

Use custom date ranges for specific periods:
- "last year" / "2025" → startDate: "2025-01-01", endDate: "2025-12-31"
- "Q3 2024" → startDate: "2024-07-01", endDate: "2024-09-30"
- "March 2025" → startDate: "2025-03-01", endDate: "2025-03-31"
- "2023" → startDate: "2023-01-01", endDate: "2023-12-31"

**When logging time:**
- Parse natural language dates/times (e.g. "yesterday 3 hours", "last Monday 9am-12pm")
- Duration in milliseconds (1h = 3600000ms), dates in ISO format
- Use findTask first to get taskId, then createEvent

**When finding/deleting events:**
- Use listEvents with filters: taskName, date range, limit (default 10)
- Show event ID, task, duration, date in a table
- To delete, use deleteEvent with the event ID

Use markdown: **bold** for emphasis, tables for data, keep responses concise.`,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(10),
    onFinish: async ({ text, steps }) => {
      // Save assistant response to DB if conversation exists
      if (conversation) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assistantParts: any[] = [];
        
        // Use steps to preserve the correct ordering of text and tool calls
        if (steps && steps.length > 0) {
          for (const step of steps) {
            // Add text from this step
            if (step.text) {
              assistantParts.push({ type: "text", text: step.text });
            }
            // Add tool calls from this step (in order)
            if (step.toolCalls) {
              for (const toolCall of step.toolCalls) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const tc = toolCall as any;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const toolResult = step.toolResults?.find((r: any) => r.toolCallId === toolCall.toolCallId) as any;
                assistantParts.push({
                  type: `tool-${toolCall.toolName}`,
                  toolCallId: toolCall.toolCallId,
                  state: "result",
                  input: tc.args || {},
                  output: toolResult?.result,
                });
              }
            }
          }
        } else if (text) {
          // Fallback if no steps available
          assistantParts.push({ type: "text", text });
        }

        await prisma.chatMessage.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: text || "",
            parts: assistantParts.length > 0 ? assistantParts : undefined,
          },
        });

        // Update conversation timestamp
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        });
      }
    },
  });

  // Return streaming response
  return result.toUIMessageStreamResponse();
}
