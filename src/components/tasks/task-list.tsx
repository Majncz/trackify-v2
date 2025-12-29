"use client";

import { useState } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { useTimer } from "@/hooks/use-timer";
import { TaskItem } from "./task-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TimerDisplay } from "@/components/timer/timer-display";

export function TaskList() {
  const [newTaskName, setNewTaskName] = useState("");
  const { tasks, isLoading, createTask, updateTask, deleteTask } = useTasks();
  const { taskId, elapsed, running, startTimer, stopTimer, isCreatingEvent } =
    useTimer();

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskName.trim()) return;

    await createTask.mutateAsync(newTaskName.trim());
    setNewTaskName("");
  };

  const visibleTasks = tasks.filter((t) => !t.hidden);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Timer Banner */}
      {running && taskId && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium">
                  Currently tracking
                </p>
                <p className="text-lg font-semibold text-gray-900">
                  {tasks.find((t) => t.id === taskId)?.name}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <TimerDisplay milliseconds={elapsed} size="lg" />
                <Button
                  onClick={stopTimer}
                  variant="danger"
                  disabled={isCreatingEvent}
                >
                  {isCreatingEvent ? "Saving..." : "Stop"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Task Form */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Add New Task</h2>
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

      {/* Task List */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-900">
          Tasks ({visibleTasks.length})
        </h2>
        {visibleTasks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              No tasks yet. Create one above to get started!
            </CardContent>
          </Card>
        ) : (
          visibleTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              isActive={taskId === task.id && running}
              elapsed={taskId === task.id ? elapsed : 0}
              onStart={() => startTimer(task.id)}
              onStop={stopTimer}
              onUpdate={(name) => updateTask.mutate({ id: task.id, name })}
              onDelete={() => deleteTask.mutate(task.id)}
              isLoading={isCreatingEvent && taskId === task.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
