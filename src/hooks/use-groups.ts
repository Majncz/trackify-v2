"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface TaskGroup {
  id: string;
  name: string;
  color?: string | null;
  taskIds: string[];
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export function useGroups() {
  const queryClient = useQueryClient();

  const query = useQuery<TaskGroup[]>({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await fetch("/api/groups");
      if (!res.ok) throw new Error("Failed to fetch groups");
      return res.json();
    },
  });

  const createGroup = useMutation({
    mutationFn: async ({
      name,
      taskIds,
      color,
    }: {
      name: string;
      taskIds: string[];
      color?: string | null;
    }) => {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, taskIds, color }),
      });
      const data = (await res.json()) as TaskGroup | { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof (data as { error?: string }).error === "string"
            ? (data as { error: string }).error
            : "Failed to create group"
        );
      }
      return data as TaskGroup;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const updateGroup = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      taskIds?: string[];
      color?: string | null;
    }) => {
      const res = await fetch(`/api/groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const out = (await res.json()) as TaskGroup | { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof (out as { error?: string }).error === "string"
            ? (out as { error: string }).error
            : "Failed to update group"
        );
      }
      return out as TaskGroup;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete group");
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return {
    groups: query.data ?? [],
    isLoading: query.isLoading,
    createGroup,
    updateGroup,
    deleteGroup,
  };
}
