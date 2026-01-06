"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EyeOff, RotateCcw } from "lucide-react";
import { formatDurationWords } from "@/lib/utils";

interface HiddenTask {
  id: string;
  name: string;
  totalTime: number;
}

export function HiddenTasks() {
  const [hiddenTasks, setHiddenTasks] = useState<HiddenTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    fetchHiddenTasks();
  }, []);

  async function fetchHiddenTasks() {
    try {
      const res = await fetch("/api/tasks?hidden=true");
      const data = await res.json();
      const tasks = data.map((task: { id: string; name: string; updatedAt: string; events: { duration: number }[] }) => ({
        id: task.id,
        name: task.name,
        totalTime: task.events.reduce((sum: number, e: { duration: number }) => sum + e.duration, 0),
        updatedAt: new Date(task.updatedAt).getTime(),
      }));
      tasks.sort((a: HiddenTask & { updatedAt: number }, b: HiddenTask & { updatedAt: number }) => 
        b.updatedAt - a.updatedAt
      );
      setHiddenTasks(tasks);
    } catch (error) {
      console.error("Failed to fetch hidden tasks:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRestore(taskId: string) {
    setRestoringId(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: false }),
      });
      if (!res.ok) throw new Error("Failed to restore");
      setHiddenTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (error) {
      console.error("Failed to restore task:", error);
    } finally {
      setRestoringId(null);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <EyeOff className="h-4 w-4" />
            Hidden Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <EyeOff className="h-4 w-4" />
          Hidden Tasks
        </CardTitle>
        <CardDescription>
          Tasks you&apos;ve hidden. Restore them to see them on your dashboard again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hiddenTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hidden tasks</p>
        ) : (
          <div className="space-y-2">
            {hiddenTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div>
                  <p className="font-medium">{task.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDurationWords(task.totalTime)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(task.id)}
                  disabled={restoringId === task.id}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  {restoringId === task.id ? "Restoring..." : "Restore"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

