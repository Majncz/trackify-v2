// Load environment variables before any other imports
import "dotenv/config";

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../src/lib/prisma";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

interface ActiveTimer {
  taskId: string;
  startTime: number;
  socketIds: Set<string>;
}

async function loadActiveTimers(): Promise<Map<string, ActiveTimer>> {
  const timers = await prisma.activeTimer.findMany({
    include: {
      task: { select: { hidden: true } },
    },
  });
  const map = new Map<string, ActiveTimer>();
  const orphanedTimerIds: string[] = [];

  for (const timer of timers) {
    // Only clean up timers for hidden tasks
    if (timer.task.hidden) {
      orphanedTimerIds.push(timer.id);
      console.log(`Cleaning up timer for hidden task (user: ${timer.userId})`);
      continue;
    }

    map.set(timer.userId, {
      taskId: timer.taskId,
      startTime: timer.startTime.getTime(),
      socketIds: new Set(),
    });
  }

  // Clean up orphaned timers from DB
  if (orphanedTimerIds.length > 0) {
    await prisma.activeTimer.deleteMany({
      where: { id: { in: orphanedTimerIds } },
    });
    console.log(`Cleaned up ${orphanedTimerIds.length} orphaned timer(s)`);
  }

  return map;
}

app.prepare().then(async () => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXTAUTH_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

  // Store active timers per user - load from DB on startup
  const activeTimers = await loadActiveTimers();
  console.log(`Loaded ${activeTimers.size} active timer(s) from database`);

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    let userId: string | null = null;

    socket.on("authenticate", (data: { userId: string }) => {
      userId = data.userId;
      socket.join(`user:${userId}`);
      console.log(`User ${userId} authenticated`);
    });

    // Client explicitly requests timer state after listeners are ready
    socket.on("timer:request-state", () => {
      if (!userId) return;

      const timer = activeTimers.get(userId);
      if (timer) {
        socket.emit("timer:state", {
          taskId: timer.taskId,
          startTime: timer.startTime,
          running: true,
        });
      }
    });

    socket.on("timer:start", async (data: { taskId: string }) => {
      if (!userId) return;

      const startTime = Date.now();

      try {
        // Persist to DB first - only update memory if successful
        await prisma.activeTimer.upsert({
          where: { userId },
          create: {
            userId,
            taskId: data.taskId,
            startTime: new Date(startTime),
          },
          update: {
            taskId: data.taskId,
            startTime: new Date(startTime),
          },
        });

        // Only update in-memory state after successful DB write
        activeTimers.set(userId, {
          taskId: data.taskId,
          startTime,
          socketIds: new Set([socket.id]),
        });

        // Broadcast to all user's devices
        io.to(`user:${userId}`).emit("timer:started", {
          taskId: data.taskId,
          startTime,
        });
      } catch (error) {
        console.error(`Failed to start timer for user ${userId}:`, error);
        // Notify client of failure
        socket.emit("timer:error", {
          action: "start",
          message: "Failed to start timer. Please try again.",
        });
      }
    });

    socket.on("timer:stop", async (data: { taskId: string; duration: number }) => {
      if (!userId) return;

      try {
        // Remove from DB first
        await prisma.activeTimer.delete({
          where: { userId },
        }).catch(() => {
          // Ignore if not found - may have been cleaned up
        });

        // Only update in-memory state after successful DB operation
        activeTimers.delete(userId);

        // Broadcast stop to all user's devices
        io.to(`user:${userId}`).emit("timer:stopped", {
          taskId: data.taskId,
          duration: data.duration,
        });
      } catch (error) {
        console.error(`Failed to stop timer for user ${userId}:`, error);
        // Still try to broadcast stop to prevent UI being stuck
        activeTimers.delete(userId);
        io.to(`user:${userId}`).emit("timer:stopped", {
          taskId: data.taskId,
          duration: data.duration,
        });
      }
    });

    socket.on("timer:update-start", async (data: { taskId: string; newStartTime: number }) => {
      if (!userId) return;

      const timer = activeTimers.get(userId);
      if (!timer) {
        socket.emit("timer:error", {
          action: "update-start",
          message: "No active timer found to adjust",
        });
        return;
      }

      if (timer.taskId !== data.taskId) {
        socket.emit("timer:error", {
          action: "update-start",
          message: "Timer has changed. Please try again.",
        });
        return;
      }

      const newStartTime = data.newStartTime;
      const now = Date.now();

      // Validate new start time is not in the future
      if (newStartTime > now) {
        socket.emit("timer:error", {
          action: "update-start",
          message: "Start time cannot be in the future",
        });
        return;
      }

      try {
        // Check for overlapping events before updating
        const overlappingEvents = await prisma.event.findMany({
          where: {
            task: { userId },
            createdAt: { lt: new Date(now) },
          },
          include: {
            task: { select: { name: true } },
          },
        });

        // Check if any events overlap with the new time range
        for (const event of overlappingEvents) {
          const eventStart = event.createdAt.getTime();
          const eventEnd = eventStart + event.duration;
          
          // Overlap if: newStart < eventEnd AND eventStart < newEnd(now)
          if (newStartTime < eventEnd && eventStart < now) {
            socket.emit("timer:error", {
              action: "update-start",
              message: `This would overlap with "${event.task.name}: ${event.name}"`,
            });
            return;
          }
        }

        // Update in database
        await prisma.activeTimer.update({
          where: { userId },
          data: {
            startTime: new Date(newStartTime),
          },
        });

        // Update in-memory state
        activeTimers.set(userId, {
          ...timer,
          startTime: newStartTime,
        });

        // Broadcast update to all user's devices
        io.to(`user:${userId}`).emit("timer:start-updated", {
          taskId: data.taskId,
          startTime: newStartTime,
        });
      } catch (error) {
        console.error(`Failed to update timer start time for user ${userId}:`, error);
        socket.emit("timer:error", {
          action: "update-start",
          message: "Failed to update start time. Please try again.",
        });
      }
    });

    socket.on("task:created", (task) => {
      if (!userId) return;
      io.to(`user:${userId}`).emit("task:created", task);
    });

    socket.on("task:updated", (task) => {
      if (!userId) return;
      io.to(`user:${userId}`).emit("task:updated", task);
    });

    socket.on("task:deleted", (taskId: string) => {
      if (!userId) return;
      
      // Clear in-memory timer if task is being deleted
      const timer = activeTimers.get(userId);
      if (timer && timer.taskId === taskId) {
        activeTimers.delete(userId);
      }
      
      io.to(`user:${userId}`).emit("task:deleted", taskId);
    });

    socket.on("event:created", (event) => {
      if (!userId) return;
      io.to(`user:${userId}`).emit("event:created", event);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
