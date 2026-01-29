"use client";

import { useState, useEffect } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { useTimer } from "@/hooks/use-timer";
import { TaskItem } from "./task-item";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TimerDisplay } from "@/components/timer/timer-display";
import { AdjustTimerDialog } from "@/components/timer/adjust-timer-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, AlertCircle, X } from "lucide-react";

export function TaskList() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [tasksPerRow, setTasksPerRow] = useState(3);
  const [isAdjustDialogOpen, setIsAdjustDialogOpen] = useState(false);
  const { tasks, isLoading } = useTasks();
  const {
    taskId,
    elapsed,
    running,
    startTime,
    startTimer,
    stopTimer,
    adjustStartTime,
    isCreatingEvent,
    createEventError,
    isAdjustingStartTime,
    adjustStartTimeError,
    clearError,
    clearAdjustError,
  } = useTimer();

  const visibleTasks = tasks
    .filter((t) => !t.hidden)
    .sort((a, b) => {
      // First: running tasks
      const aIsRunning = taskId === a.id && running;
      const bIsRunning = taskId === b.id && running;
      
      if (aIsRunning && !bIsRunning) return -1;
      if (!aIsRunning && bIsRunning) return 1;
      
      // Second: new tasks (no events) at top
      const aHasEvents = a.events.length > 0;
      const bHasEvents = b.events.length > 0;
      
      if (!aHasEvents && bHasEvents) return -1;
      if (aHasEvents && !bHasEvents) return 1;
      
      // Then: sort by most recent event (most recent first)
      if (aHasEvents && bHasEvents) {
        const aMostRecent = Math.max(...a.events.map((e) => new Date(e.from).getTime()));
        const bMostRecent = Math.max(...b.events.map((e) => new Date(e.from).getTime()));
        return bMostRecent - aMostRecent;
      }
      
      return 0;
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
      {/* Error Alert */}
      {createEventError && (
        <Alert variant="destructive" className="relative">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to save time entry</AlertTitle>
          <AlertDescription>
            {createEventError.message}
          </AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-6 w-6 p-0"
            onClick={clearError}
          >
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      )}

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
                <TimerDisplay
                  milliseconds={elapsed}
                  size="lg"
                  onClick={() => setIsAdjustDialogOpen(true)}
                  clickable={true}
                />
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
              No tasks yet. Click &quot;New Task&quot; to get started!
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

      {/* Adjust Timer Dialog */}
      {running && taskId && startTime && (
        <AdjustTimerDialog
          open={isAdjustDialogOpen}
          onOpenChange={setIsAdjustDialogOpen}
          currentStartTime={startTime}
          onAdjust={adjustStartTime}
          onClearError={clearAdjustError}
          isAdjusting={isAdjustingStartTime}
          error={
            adjustStartTimeError instanceof Error
              ? adjustStartTimeError.message
              : null
          }
        />
      )}
    </div>
  );
}
