"use client";

import { useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import { getSocket } from "@/lib/socket";

export function useSocket() {
  const { data: session } = useSession();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;

    const socket = getSocket();
    socketRef.current = socket;

    socket.connect();

    socket.on("connect", () => {
      socket.emit("authenticate", { userId: session.user.id });
    });

    return () => {
      socket.disconnect();
    };
  }, [session?.user?.id]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const on = useCallback((event: string, callback: (data: unknown) => void) => {
    socketRef.current?.on(event, callback);
    return () => {
      socketRef.current?.off(event, callback);
    };
  }, []);

  return { emit, on, socket: socketRef.current };
}
