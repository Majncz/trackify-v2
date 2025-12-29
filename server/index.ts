import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer } from "socket.io";

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

app.prepare().then(() => {
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

  // Store active timers per user
  const activeTimers = new Map<string, ActiveTimer>();

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    let userId: string | null = null;

    socket.on("authenticate", (data: { userId: string }) => {
      userId = data.userId;
      socket.join(`user:${userId}`);

      // Send current timer state if exists
      const timer = activeTimers.get(userId);
      if (timer) {
        socket.emit("timer:state", {
          taskId: timer.taskId,
          startTime: timer.startTime,
          running: true,
        });
      }
    });

    socket.on("timer:start", (data: { taskId: string }) => {
      if (!userId) return;

      activeTimers.set(userId, {
        taskId: data.taskId,
        startTime: Date.now(),
        socketIds: new Set([socket.id]),
      });

      // Broadcast to all user's devices
      io.to(`user:${userId}`).emit("timer:started", {
        taskId: data.taskId,
        startTime: Date.now(),
      });
    });

    socket.on("timer:stop", (data: { taskId: string; duration: number }) => {
      if (!userId) return;

      activeTimers.delete(userId);

      // Broadcast stop to all user's devices
      io.to(`user:${userId}`).emit("timer:stopped", {
        taskId: data.taskId,
        duration: data.duration,
      });
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
