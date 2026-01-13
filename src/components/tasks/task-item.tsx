"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationWords } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Play, Square } from "lucide-react";

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
  onStart: () => void;
  onStop: () => void;
  isLoading?: boolean;
}

export function TaskItem({
  task,
  isActive,
  onStart,
  onStop,
  isLoading,
}: TaskItemProps) {
  const router = useRouter();
  const totalTime = task.events.reduce((sum, e) => sum + e.duration, 0);

  function handleCardClick(e: React.MouseEvent) {
    // Don't navigate if clicking on buttons
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("[role='button']") ||
      target.tagName === "BUTTON"
    ) {
      return;
    }
    router.push(`/tasks/${task.id}`);
  }

  function handleStartClick(e: React.MouseEvent) {
    e.stopPropagation();
    onStart();
  }

  function handleStopClick(e: React.MouseEvent) {
    e.stopPropagation();
    onStop();
    }

  return (
    <Card
      className={cn(
        "transition-all h-full flex flex-col cursor-pointer",
        isActive && "border-primary ring-1 ring-primary"
      )}
      onClick={handleCardClick}
    >
      <CardContent className="p-4 flex flex-col flex-1">
        <div className="mb-3">
          <h3 className="font-medium truncate">{task.name}</h3>
        </div>

        <p className={cn(
          "text-sm text-muted-foreground mb-3",
          isLoading && "animate-pulse opacity-70"
        )}>
          Total: {formatDurationWords(totalTime)}
        </p>

        <div className="mt-auto">
            {isActive ? (
                <Button
              onClick={handleStopClick}
                  variant="destructive"
                  size="sm"
                  disabled={isLoading}
              className="w-full"
                >
                  <Square className="h-4 w-4 mr-1" />
                  {isLoading ? "Saving..." : "Stop"}
                </Button>
            ) : (
            <Button onClick={handleStartClick} size="sm" className="w-full">
                  <Play className="h-4 w-4 mr-1" />
                  Start
                </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
