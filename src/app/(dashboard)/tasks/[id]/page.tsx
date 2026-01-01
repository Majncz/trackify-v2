"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTasks } from "@/hooks/use-tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationWords } from "@/lib/utils";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function TaskDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { tasks, isLoading, updateTask, deleteTask } = useTasks();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const task = tasks.find((t) => t.id === params.id);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-6">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Task not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalTime = task.events.reduce((sum, e) => sum + e.duration, 0);

  function handleEditClick() {
    setEditName(task.name);
    setIsEditing(true);
  }

  function handleSave() {
    if (editName.trim() && editName !== task.name) {
      updateTask.mutate({ id: task.id, name: editName.trim() });
    }
    setIsEditing(false);
  }

  function handleCancel() {
    setEditName(task.name);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  }

  async function handleDelete() {
    if (confirm("Are you sure you want to delete this task?")) {
      await deleteTask.mutateAsync(task.id);
      router.push("/");
    }
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        onClick={() => router.back()}
        className="flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">
              {isEditing ? (
                <Input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSave}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="text-xl font-semibold"
                />
              ) : (
                <span onClick={handleEditClick} className="cursor-pointer">
                  {task.name}
                </span>
              )}
            </CardTitle>
            {!isEditing && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteTask.isPending}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {deleteTask.isPending ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Total Time</p>
            <p className="text-2xl font-bold">
              {formatDurationWords(totalTime)}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-1">
              Tracking Sessions
            </p>
            <p className="text-lg font-semibold">{task.events.length}</p>
          </div>

          {task.events.length > 0 && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Recent Sessions
              </p>
              <div className="space-y-2">
                {task.events
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime()
                  )
                  .slice(0, 10)
                  .map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between p-2 bg-muted rounded-md"
                    >
                      <span className="text-sm">
                        {new Date(event.createdAt).toLocaleDateString()}{" "}
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </span>
                      <span className="text-sm font-medium">
                        {formatDurationWords(event.duration)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


