"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import { getSocket, disconnectSocket } from "@/lib/socket";
import { startTimerDurability } from "@/lib/timer-durability";

type EventCallback = (data: unknown) => void;
type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

interface QueuedEmit {
  event: string;
  data?: unknown;
}

interface SocketContextValue {
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  emit: (event: string, data?: unknown) => void;
  on: (event: string, callback: EventCallback) => () => void;
  requestTimerState: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const RED_GRACE_MS = 8000;
const HIDDEN_RECONNECT_MS = 12000;

export function SocketProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const listenersRef = useRef<Map<string, Set<EventCallback>>>(new Map());
  const queueRef = useRef<QueuedEmit[]>([]);
  const redTimerRef = useRef<number | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const userIdRef = useRef<string | null>(null);

  const clearRedTimer = useCallback(() => {
    if (redTimerRef.current != null) {
      window.clearTimeout(redTimerRef.current);
      redTimerRef.current = null;
    }
  }, []);

  const markConnected = useCallback(() => {
    clearRedTimer();
    setIsConnected(true);
    setConnectionStatus("connected");
  }, [clearRedTimer]);

  const markDisconnected = useCallback(() => {
    setIsConnected(false);
    setConnectionStatus("reconnecting");
    clearRedTimer();
    redTimerRef.current = window.setTimeout(() => {
      setConnectionStatus((current) =>
        current === "connected" ? current : "disconnected"
      );
    }, RED_GRACE_MS);
  }, [clearRedTimer]);

  const attachBufferedListeners = useCallback((socket: Socket) => {
    listenersRef.current.forEach((callbacks, event) => {
      callbacks.forEach((callback) => {
        socket.off(event, callback);
        socket.on(event, callback);
      });
    });
  }, []);

  const flushQueue = useCallback((socket: Socket) => {
    if (!socket.connected) return;
    const pending = queueRef.current;
    queueRef.current = [];
    pending.forEach(({ event, data }) => {
      socket.emit(event, data);
    });
  }, []);

  const enqueue = useCallback((event: string, data?: unknown) => {
    if (event === "timer:start" || event === "timer:stop" || event === "timer:update-start") {
      queueRef.current = queueRef.current.filter(
        (item) =>
          item.event !== "timer:start" &&
          item.event !== "timer:stop" &&
          item.event !== "timer:update-start"
      );
    }
    queueRef.current.push({ event, data });
    if (queueRef.current.length > 40) {
      queueRef.current.shift();
    }
  }, []);

  const ensureConnected = useCallback(() => {
    const socket = socketRef.current ?? getSocket();
    socketRef.current = socket;
    if (!socket.connected) {
      socket.connect();
    }
  }, []);

  useEffect(() => {
    startTimerDurability();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    userIdRef.current = userId ?? null;

    if (!userId) {
      clearRedTimer();
      setIsConnected(false);
      setConnectionStatus("disconnected");
      disconnectSocket();
      socketRef.current = null;
      return;
    }

    const socket = getSocket();
    socketRef.current = socket;

    function handleConnect() {
      markConnected();
      socket.emit("authenticate", { userId });
      attachBufferedListeners(socket);
      flushQueue(socket);
    }

    function handleDisconnect() {
      markDisconnected();
    }

    function handleReconnectAttempt() {
      setIsConnected(false);
      setConnectionStatus("reconnecting");
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleDisconnect);
    socket.io.on("reconnect_attempt", handleReconnectAttempt);

    if (socket.connected) {
      handleConnect();
    } else {
      setConnectionStatus("reconnecting");
      socket.connect();
    }

    function recover(force = false) {
      const current = socketRef.current;
      if (!current || !userIdRef.current) return;

      if (force || !current.connected) {
        if (current.connected) {
          current.disconnect();
        }
        current.connect();
        return;
      }

      current.emit("timer:request-state");
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor = hiddenAtRef.current
        ? Date.now() - hiddenAtRef.current
        : 0;
      hiddenAtRef.current = null;
      recover(hiddenFor >= HIDDEN_RECONNECT_MS);
    }

    function onOnline() {
      recover(true);
    }

    function onPageShow(event: PageTransitionEvent) {
      recover(event.persisted || !socket.connected);
    }

    function onFocus() {
      recover(false);
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleDisconnect);
      socket.io.off("reconnect_attempt", handleReconnectAttempt);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      // Keep the singleton socket alive across layout remounts / session refetches.
      // Calling disconnect() here disables Socket.IO auto-reconnect.
    };
  }, [
    session?.user?.id,
    attachBufferedListeners,
    flushQueue,
    markConnected,
    markDisconnected,
    clearRedTimer,
  ]);

  const emit = useCallback(
    (event: string, data?: unknown) => {
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit(event, data);
        return;
      }
      enqueue(event, data);
      ensureConnected();
    },
    [enqueue, ensureConnected]
  );

  const on = useCallback((event: string, callback: EventCallback) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    if (socketRef.current?.connected) {
      socketRef.current.on(event, callback);
    }

    return () => {
      listenersRef.current.get(event)?.delete(callback);
      socketRef.current?.off(event, callback);
    };
  }, []);

  const requestTimerState = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("timer:request-state");
    }
  }, []);

  return (
    <SocketContext.Provider
      value={{ isConnected, connectionStatus, emit, on, requestTimerState }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketContext() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocketContext must be used within a SocketProvider");
  }
  return context;
}
