import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { validateNoOverlap, OverlapError } from "@/lib/event-overlap";
import { fromZonedTime } from "date-fns-tz";

// Parse a date string as being in the user's timezone
function parseInTimezone(dateStr: string, timezone: string): Date {
  // If the string already has timezone info (Z or +/-), parse directly
  if (dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  
  // Parse date components explicitly to avoid timezone ambiguity
  // e.g., "2026-01-19T14:00:00" should be interpreted as 2pm in the user's timezone
  const [datePart, timePart = "00:00:00"] = dateStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
  
  // Create a date object with the user's local time components
  // then convert it to UTC considering their timezone
  const localDate = new Date(year, month - 1, day, hour, minute, second);
  return fromZonedTime(localDate, timezone);
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = user.id;
  const body = await req.json();
  
  // Validate timezone
  let timezone = "UTC";
  if (body.timezone) {
    try {
      // Test if timezone is valid by trying to use it
      Intl.DateTimeFormat(undefined, { timeZone: body.timezone });
      timezone = body.timezone;
    } catch {
      console.warn(`Invalid timezone "${body.timezone}", falling back to UTC`);
    }
  }
  
  const { toolName, args } = body;

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
        const { taskId, from, to, name } = args;
        
        if (!from || !to) {
          result = { success: false, error: "Both from and to timestamps are required" };
          break;
        }
        
        const task = await prisma.task.findFirst({
          where: { id: taskId, userId },
        });

        if (!task) {
          result = { success: false, error: "Task not found" };
          break;
        }

        const eventFrom = parseInTimezone(from, timezone);
        const eventTo = parseInTimezone(to, timezone);
        
        // Validate to > from
        if (eventTo <= eventFrom) {
          result = { success: false, error: "End time must be after start time" };
          break;
        }
        
        // Validate event doesn't end in the future
        if (eventTo > new Date()) {
          result = { success: false, error: "Cannot create events that end in the future" };
          break;
        }
        
        try {
          await validateNoOverlap({
            userId,
            eventFrom,
            eventTo,
          });
        } catch (err) {
          if (err instanceof OverlapError) {
            result = { success: false, error: err.message };
            break;
          }
          throw err;
        }

        const event = await prisma.event.create({
          data: {
            taskId,
            name: name || "Time entry",
            from: eventFrom,
            to: eventTo,
          },
        });

        const durationMs = event.to.getTime() - event.from.getTime();
        const hours = Math.floor(durationMs / 3600000);
        const minutes = Math.floor((durationMs % 3600000) / 60000);
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const dateStr = event.from.toLocaleDateString("en-US", { 
          weekday: "short", month: "short", day: "numeric", timeZone: timezone 
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

        const durationMs = event.to.getTime() - event.from.getTime();
        const hours = Math.floor(durationMs / 3600000);
        const minutes = Math.floor((durationMs % 3600000) / 60000);
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const dateStr = event.from.toLocaleDateString("en-US", { 
          weekday: "short", month: "short", day: "numeric", timeZone: timezone 
        });

        await prisma.event.delete({ where: { id: eventId } });
        result = {
          success: true,
          message: `Deleted ${durationStr} entry from "${event.task.name}" (${dateStr})`,
        };
        break;
      }

      case "updateEvent": {
        const { eventId, newFrom, newTo } = args;
        
        if (!newFrom && !newTo) {
          result = { success: false, error: "Must provide newFrom or newTo (or both)" };
          break;
        }

        const event = await prisma.event.findFirst({
          where: { id: eventId, task: { userId } },
          include: { task: { select: { name: true } } },
        });

        if (!event) {
          result = { success: false, error: "Event not found" };
          break;
        }

        const finalFrom = newFrom ? parseInTimezone(newFrom, timezone) : event.from;
        const finalTo = newTo ? parseInTimezone(newTo, timezone) : event.to;
        
        // Validate to > from
        if (finalTo <= finalFrom) {
          result = { success: false, error: "End time must be after start time" };
          break;
        }
        
        // Validate updated event doesn't end in the future
        if (finalTo > new Date()) {
          result = { success: false, error: "Cannot update event to end in the future" };
          break;
        }

        // Check for overlapping events (excluding current event)
        try {
          await validateNoOverlap({
            userId,
            eventFrom: finalFrom,
            eventTo: finalTo,
            excludeEventId: eventId,
          });
        } catch (err) {
          if (err instanceof OverlapError) {
            result = { success: false, error: err.message };
            break;
          }
          throw err;
        }

        const updateData: { from?: Date; to?: Date } = {};
        const changes: string[] = [];

        // Handle from change
        if (newFrom) {
          updateData.from = finalFrom;
          const newFromStr = finalFrom.toLocaleDateString("en-US", { 
            weekday: "short", month: "short", day: "numeric", timeZone: timezone 
          });
          const oldFromStr = event.from.toLocaleDateString("en-US", { 
            weekday: "short", month: "short", day: "numeric", timeZone: timezone 
          });
          changes.push(`start time moved from ${oldFromStr} to ${newFromStr}`);
        }

        // Handle to change
        if (newTo) {
          updateData.to = finalTo;
          const newToStr = finalTo.toLocaleDateString("en-US", { 
            weekday: "short", month: "short", day: "numeric", timeZone: timezone 
          });
          const oldToStr = event.to.toLocaleDateString("en-US", { 
            weekday: "short", month: "short", day: "numeric", timeZone: timezone 
          });
          changes.push(`end time moved from ${oldToStr} to ${newToStr}`);
        }

        await prisma.event.update({
          where: { id: eventId },
          data: updateData,
        });

        result = {
          success: true,
          message: `Updated "${event.task.name}" entry: ${changes.join(", ")}`,
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
