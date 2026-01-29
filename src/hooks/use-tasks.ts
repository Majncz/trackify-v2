"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSocket } from "./use-socket";
import { useEffect } from "react";

interface Event {
  id: string;
  from: string;
  to: string;
  name: string;
  taskId: string;
}

interface Task {
  id: string;
  name: string;
  hidden: boolean;
  userId: string;
  events: Event[];
}

export function useTasks() {
  const queryClient = useQueryClient();
  const { on, emit } = useSocket();

  const query = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: async () => {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  // Listen for real-time updates
  useEffect(() => {
    const unsubCreated = on("task:created", () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    });

    const unsubUpdated = on("task:updated", () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    });

    const unsubDeleted = on("task:deleted", () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    });

    const unsubEvent = on("event:created", () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    });

    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
      unsubEvent();
    };
  }, [on, queryClient]);

  const createTask = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create task");
      return res.json();
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      emit("task:created", task);
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      hidden?: boolean;
    }) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update task");
      return res.json();
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      emit("task:updated", task);
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete task");
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // Notify server to stop any running timer for this task
      emit("task:hidden", id);
      emit("task:deleted", id);
    },
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createTask,
    updateTask,
    deleteTask,
  };
}
