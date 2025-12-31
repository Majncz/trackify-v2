"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { TimerDisplay } from "@/components/timer/timer-display";
import { formatDurationWords } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { MoreVertical, Play, Square, Pencil, Trash2 } from "lucide-react";

interface Event {
  id: string;
  duration: number;
  createdAt: string;
}

interface Task {
  id: string;
  name: string;
  hidden: boolean;
  events: Event[];
}

interface TaskItemProps {
  task: Task;
  isActive: boolean;
  elapsed: number;
  onStart: () => void;
  onStop: () => void;
  onUpdate: (name: string) => void;
  onDelete: () => void;
  isLoading?: boolean;
}

export function TaskItem({
  task,
  isActive,
  elapsed,
  onStart,
  onStop,
  onUpdate,
  onDelete,
  isLoading,
}: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(task.name);
  const [showMenu, setShowMenu] = useState(false);

  const totalTime = task.events.reduce((sum, e) => sum + e.duration, 0);

  const handleSave = () => {
    if (editName.trim() && editName !== task.name) {
      onUpdate(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditName(task.name);
      setIsEditing(false);
    }
  };

  return (
    <Card
      className={cn(
        "transition-all",
        isActive && "border-primary ring-1 ring-primary"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <Input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                autoFocus
                className="max-w-xs"
              />
            ) : (
              <h3
                className="font-medium truncate cursor-pointer hover:text-primary"
                onClick={() => setIsEditing(true)}
              >
                {task.name}
              </h3>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Total: {formatDurationWords(totalTime)}
            </p>
          </div>

          <div className="flex items-center gap-3 ml-4">
            {isActive ? (
              <>
                <TimerDisplay milliseconds={elapsed} size="md" />
                <Button
                  onClick={onStop}
                  variant="destructive"
                  size="sm"
                  disabled={isLoading}
                >
                  <Square className="h-4 w-4 mr-1" />
                  {isLoading ? "Saving..." : "Stop"}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={onStart} size="sm">
                  <Play className="h-4 w-4 mr-1" />
                  Start
                </Button>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShowMenu(!showMenu)}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                  {showMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowMenu(false)}
                      />
                      <div className="absolute right-0 mt-1 w-32 bg-popover rounded-md shadow-lg border z-20">
                        <button
                          onClick={() => {
                            setIsEditing(true);
                            setShowMenu(false);
                          }}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left hover:bg-accent rounded-t-md"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            onDelete();
                            setShowMenu(false);
                          }}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left text-destructive hover:bg-destructive/10 rounded-b-md"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
