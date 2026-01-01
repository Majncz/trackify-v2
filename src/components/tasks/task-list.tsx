"use client";

import { useState, useEffect } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { useTimer } from "@/hooks/use-timer";
import { TaskItem } from "./task-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimerDisplay } from "@/components/timer/timer-display";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";

export function TaskList() {
  const [newTaskName, setNewTaskName] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [tasksPerRow, setTasksPerRow] = useState(3);
  const { tasks, isLoading, createTask, updateTask, deleteTask } = useTasks();
  const { taskId, elapsed, running, startTimer, stopTimer, isCreatingEvent } =
    useTimer();

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskName.trim()) return;

    await createTask.mutateAsync(newTaskName.trim());
    setNewTaskName("");
  };

  const visibleTasks = tasks
    .filter((t) => !t.hidden)
    .sort((a, b) => {
      // First: running tasks
      const aIsRunning = taskId === a.id && running;
      const bIsRunning = taskId === b.id && running;
      
      if (aIsRunning && !bIsRunning) return -1;
      if (!aIsRunning && bIsRunning) return 1;
      
      // Then: sort by most recent event
      const aMostRecent = a.events.length > 0
        ? Math.max(...a.events.map((e) => new Date(e.createdAt).getTime()))
        : 0;
      const bMostRecent = b.events.length > 0
        ? Math.max(...b.events.map((e) => new Date(e.createdAt).getTime()))
        : 0;
      
      return bMostRecent - aMostRecent; // Most recent first
    });

  // Calculate how many tasks fit in 2 rows based on screen size
  useEffect(() => {
    function updateTasksPerRow() {
      const width = window.innerWidth;
      if (width < 1024) {
        setTasksPerRow(2); // Mobile/Tablet: 2 columns
      } else if (width < 1280) {
        setTasksPerRow(3); // Desktop: 3 columns
      } else {
        setTasksPerRow(4); // XL: 4 columns
      }
    }

    updateTasksPerRow();
    window.addEventListener("resize", updateTasksPerRow);
    return () => window.removeEventListener("resize", updateTasksPerRow);
  }, []);

  const maxVisibleTasks = tasksPerRow * 2; // 2 rows
  const shouldShowExpand = visibleTasks.length > maxVisibleTasks;
  const displayedTasks = isExpanded
    ? visibleTasks
    : visibleTasks.slice(0, maxVisibleTasks);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Timer Banner */}
      {running && taskId && (
        <Card className="border-primary bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-primary font-medium">
                  Currently tracking
                </p>
                <p className="text-lg font-semibold">
                  {tasks.find((t) => t.id === taskId)?.name}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <TimerDisplay milliseconds={elapsed} size="lg" />
                <Button
                  onClick={stopTimer}
                  variant="destructive"
                  disabled={isCreatingEvent}
                >
                  {isCreatingEvent ? "Saving..." : "Stop"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tasks Grid */}
      <div className="space-y-4">
        <h2 className="font-semibold">
          Tasks ({visibleTasks.length})
        </h2>
        {visibleTasks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No tasks yet. Create one below to get started!
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {displayedTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  isActive={taskId === task.id && running}
                  onStart={() => startTimer(task.id)}
                  onStop={stopTimer}
                  isLoading={isCreatingEvent && taskId === task.id}
                />
              ))}
            </div>
            {shouldShowExpand && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-2"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Show Less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Show All ({visibleTasks.length - maxVisibleTasks} more)
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* New Task Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add New Task</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateTask} className="flex gap-3">
            <Input
              type="text"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              placeholder="Enter task name..."
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={!newTaskName.trim() || createTask.isPending}
            >
              {createTask.isPending ? "Adding..." : "Add Task"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
