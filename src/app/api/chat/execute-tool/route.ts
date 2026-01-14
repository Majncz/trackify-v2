import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateNoOverlap, OverlapError } from "@/lib/event-overlap";
import { fromZonedTime } from "date-fns-tz";

// Parse a date string as being in the user's timezone
function parseInTimezone(dateStr: string, timezone: string): Date {
  // If the string already has timezone info (Z or +/-), parse directly
  if (dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  // Otherwise, interpret as user's local time
  const localDate = new Date(dateStr);
  return fromZonedTime(localDate, timezone);
}

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const { toolName, args, timezone = "UTC" } = await req.json();

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
        
        // Validate duration
        if (!duration || duration <= 0) {
          result = { success: false, error: "Duration must be positive" };
          break;
        }
        
        const task = await prisma.task.findFirst({
          where: { id: taskId, userId },
        });

        if (!task) {
          result = { success: false, error: "Task not found" };
          break;
        }

        // Check for overlapping events
        const now = new Date();
        const eventStart = createdAt 
          ? parseInTimezone(createdAt, timezone) 
          : new Date(now.getTime() - duration);
        const eventEnd = new Date(eventStart.getTime() + duration);
        
        // Validate event doesn't end in the future
        if (eventEnd > now) {
          result = { success: false, error: "Cannot create events that end in the future" };
          break;
        }
        try {
          await validateNoOverlap({
            userId,
            eventStart,
            duration,
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
            duration,
            createdAt: eventStart,
          },
        });

        const hours = Math.floor(duration / 3600000);
        const minutes = Math.floor((duration % 3600000) / 60000);
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const dateStr = event.createdAt.toLocaleDateString("en-US", { 
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

        const hours = Math.floor(event.duration / 3600000);
        const minutes = Math.floor((event.duration % 3600000) / 60000);
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const dateStr = event.createdAt.toLocaleDateString("en-US", { 
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
        const { eventId, newDate, newDuration } = args;
        
        if (!newDate && !newDuration) {
          result = { success: false, error: "Must provide newDate or newDuration (or both)" };
          break;
        }
        
        // Validate duration if provided
        if (newDuration !== undefined && newDuration <= 0) {
          result = { success: false, error: "Duration must be positive" };
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

        // Validate updated event doesn't end in the future
        const now = new Date();
        const finalStart = newDate ? parseInTimezone(newDate, timezone) : event.createdAt;
        const finalDuration = newDuration ?? event.duration;
        const finalEnd = new Date(finalStart.getTime() + finalDuration);
        
        if (finalEnd > now) {
          result = { success: false, error: "Cannot update event to end in the future" };
          break;
        }

        const updateData: { createdAt?: Date; duration?: number } = {};
        const changes: string[] = [];

        // Handle date change
        if (newDate) {
          const newEventStart = parseInTimezone(newDate, timezone);
          const durationToCheck = newDuration ?? event.duration;
          
          // Check for overlapping events (excluding current event)
          try {
            await validateNoOverlap({
              userId,
              eventStart: newEventStart,
              duration: durationToCheck,
              excludeEventId: eventId,
            });
          } catch (err) {
            if (err instanceof OverlapError) {
              result = { success: false, error: err.message };
              break;
            }
            throw err;
          }
          
          updateData.createdAt = newEventStart;
          const newDateStr = newEventStart.toLocaleDateString("en-US", { 
            weekday: "short", month: "short", day: "numeric", timeZone: timezone 
          });
          const oldDateStr = event.createdAt.toLocaleDateString("en-US", { 
            weekday: "short", month: "short", day: "numeric", timeZone: timezone 
          });
          changes.push(`moved from ${oldDateStr} to ${newDateStr}`);
        }

        // Handle duration change
        if (newDuration) {
          // If date didn't change, still check for overlaps with new duration
          if (!newDate) {
            try {
              await validateNoOverlap({
                userId,
                eventStart: event.createdAt,
                duration: newDuration,
                excludeEventId: eventId,
              });
            } catch (err) {
              if (err instanceof OverlapError) {
                result = { success: false, error: err.message };
                break;
              }
              throw err;
            }
          }
          
          updateData.duration = newDuration;
          const oldHours = Math.floor(event.duration / 3600000);
          const oldMinutes = Math.floor((event.duration % 3600000) / 60000);
          const oldDurationStr = oldHours > 0 ? `${oldHours}h ${oldMinutes}m` : `${oldMinutes}m`;
          const newHours = Math.floor(newDuration / 3600000);
          const newMinutes = Math.floor((newDuration % 3600000) / 60000);
          const newDurationStr = newHours > 0 ? `${newHours}h ${newMinutes}m` : `${newMinutes}m`;
          changes.push(`duration changed from ${oldDurationStr} to ${newDurationStr}`);
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
