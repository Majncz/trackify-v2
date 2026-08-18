"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSocket } from "./use-socket";

export type PresenceEntry = {
  userId: string;
  name: string;
  taskName: string;
  startTime: number;
};

export function usePresence() {
  const queryClient = useQueryClient();
  const { on } = useSocket();

  const query = useQuery<{ tracking: PresenceEntry[] }>({
    queryKey: ["presence"],
    queryFn: async () => {
      const res = await fetch("/api/presence");
      if (!res.ok) throw new Error("Failed to load who's tracking");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    return on("presence:changed", () => {
      queryClient.invalidateQueries({ queryKey: ["presence"] });
    });
  }, [on, queryClient]);

  return {
    tracking: query.data?.tracking ?? [],
    isLoading: query.isLoading,
  };
}
