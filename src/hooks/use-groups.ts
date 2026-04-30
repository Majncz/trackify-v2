"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface TaskGroup {
  id: string;
  name: string;
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
    mutationFn: async ({ name, taskIds }: { name: string; taskIds: string[] }) => {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, taskIds }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      return res.json() as Promise<TaskGroup>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });

  const updateGroup = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string; name?: string; taskIds?: string[] }) => {
      const res = await fetch(`/api/groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update group");
      return res.json() as Promise<TaskGroup>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete group");
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });

  return {
    groups: query.data ?? [],
    isLoading: query.isLoading,
    createGroup,
    updateGroup,
    deleteGroup,
  };
}
