"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import { getSocket } from "@/lib/socket";

type EventCallback = (data: unknown) => void;

interface SocketContextValue {
  isConnected: boolean;
  emit: (event: string, data?: unknown) => void;
  on: (event: string, callback: EventCallback) => () => void;
  requestTimerState: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<EventCallback>>>(new Map());

  useEffect(() => {
    if (!session?.user?.id) return;

    const userId = session.user.id;
    const socket = getSocket();
    socketRef.current = socket;
    const listeners = listenersRef.current;

    function handleConnect() {
      setIsConnected(true);
      socket.emit("authenticate", { userId });
      
      // Re-attach all buffered listeners
      listeners.forEach((callbacks, event) => {
        callbacks.forEach((callback) => {
          socket.on(event, callback);
        });
      });
    }

    function handleDisconnect() {
      setIsConnected(false);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // If already connected (reconnecting scenario)
    if (socket.connected) {
      handleConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      
      // Remove all event listeners
      listeners.forEach((callbacks, event) => {
        callbacks.forEach((callback) => {
          socket.off(event, callback);
        });
      });
      
      socket.disconnect();
    };
  }, [session?.user?.id]);

  const emit = useCallback((event: string, data?: unknown) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const on = useCallback((event: string, callback: EventCallback) => {
    // Store listener in buffer
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    // If socket is already connected, attach immediately
    if (socketRef.current?.connected) {
      socketRef.current.on(event, callback);
    }

    // Return unsubscribe function
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
    <SocketContext.Provider value={{ isConnected, emit, on, requestTimerState }}>
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


