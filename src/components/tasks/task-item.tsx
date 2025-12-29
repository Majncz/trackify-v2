"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TimerDisplay } from "@/components/timer/timer-display";
import { formatDurationWords } from "@/lib/utils";
import { cn } from "@/lib/utils";

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
    <div
      className={cn(
        "bg-white rounded-lg border p-4 transition-all",
        isActive ? "border-blue-500 shadow-md" : "border-gray-200 hover:border-gray-300"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <h3
              className="font-medium text-gray-900 truncate cursor-pointer hover:text-blue-600"
              onClick={() => setIsEditing(true)}
            >
              {task.name}
            </h3>
          )}
          <p className="text-sm text-gray-500 mt-1">
            Total: {formatDurationWords(totalTime)}
          </p>
        </div>

        <div className="flex items-center gap-3 ml-4">
          {isActive ? (
            <>
              <TimerDisplay milliseconds={elapsed} size="md" />
              <Button
                onClick={onStop}
                variant="danger"
                size="sm"
                disabled={isLoading}
              >
                {isLoading ? "Saving..." : "Stop"}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onStart} variant="primary" size="sm">
                Start
              </Button>
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                    />
                  </svg>
                </button>
                {showMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowMenu(false)}
                    />
                    <div className="absolute right-0 mt-1 w-32 bg-white rounded-md shadow-lg border border-gray-200 z-20">
                      <button
                        onClick={() => {
                          setIsEditing(true);
                          setShowMenu(false);
                        }}
                        className="block w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          onDelete();
                          setShowMenu(false);
                        }}
                        className="block w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-red-50"
                      >
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
    </div>
  );
}
