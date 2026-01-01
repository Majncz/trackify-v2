"use client";

import { useSocketContext } from "@/contexts/socket-context";

export function useSocket() {
  return useSocketContext();
}
