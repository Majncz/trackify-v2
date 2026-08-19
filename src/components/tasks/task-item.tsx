"use client";

import type { MouseEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationWords, cn } from "@/lib/utils";
import { resolveGroupAccent, hexToRgba } from "@/lib/group-accent";
import { LogPastDialog } from "@/components/timer/log-past-dialog";
import { sliderGestureBlocksUi } from "@/components/timer/session-range-slider";
import { Play, Plus, Square } from "lucide-react";

interface Event {
  id: string;
  from: string;
  to: string;
}

interface Task {
  id: string;
  name: string;
  hidden: boolean;
  events: Event[];
  taskGroup?: { id: string; name: string; color?: string | null } | null;
}

interface TaskItemProps {
  task: Task;
  isActive: boolean;
  onStart: () => void;
  onStop: () => void;
  isLoading?: boolean;
  pendingConfirmation?: boolean;
  liveMs?: number;
}

export function TaskItem({
  task,
  isActive,
  onStart,
  onStop,
  isLoading,
  pendingConfirmation,
  liveMs = 0,
}: TaskItemProps) {
  const router = useRouter();
  const [logOpen, setLogOpen] = useState(false);
  const group = task.taskGroup ?? null;
  const accentHex = group ? resolveGroupAccent({ id: group.id, color: group.color }) : null;
  const totalTime = task.events.reduce((sum, e) => {
    const fromMs = new Date(e.from).getTime();
    const toMs = new Date(e.to).getTime();
    return sum + (toMs - fromMs);
  }, 0);

  function handleCardClick(e: MouseEvent) {
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

  function handleStartClick(e: MouseEvent) {
    e.stopPropagation();
    onStart();
  }

  function handleStopClick(e: MouseEvent) {
    e.stopPropagation();
    onStop();
  }

  return (
    <Card
      className={cn(
        "h-full flex flex-col cursor-pointer rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background z-0",
        pendingConfirmation &&
          "animate-pending-pulse ring-2 ring-yellow-500 ring-offset-2 ring-offset-background"
      )}
      onClick={(e) => {
        if (sliderGestureBlocksUi()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        handleCardClick(e);
      }}
    >
      <CardContent className="p-4 flex flex-col flex-1">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="font-medium truncate min-w-0">{task.name}</h3>
          {group ? (
            <span
              className="shrink-0 max-w-[min(11rem,48%)] truncate rounded-xl border px-2.5 py-1 text-[10px] font-medium leading-tight shadow-sm"
              style={{
                borderColor: accentHex ? hexToRgba(accentHex, 0.92) : undefined,
                color: accentHex ?? undefined,
              }}
              title={group.name}
            >
              {group.name}
            </span>
          ) : null}
        </div>

        <p
          className={cn(
            "text-sm text-muted-foreground mb-3",
            isLoading && "animate-pulse opacity-70"
          )}
        >
          Total: {formatDurationWords(totalTime + liveMs)}
        </p>

        <div className="mt-auto flex gap-2">
          {isActive ? (
            <Button
              onClick={handleStopClick}
              variant="destructive"
              size="sm"
              disabled={isLoading}
              className="min-w-0 flex-1"
            >
              <Square className="h-4 w-4 mr-1" />
              {isLoading ? "Saving..." : pendingConfirmation ? "Syncing..." : "Stop"}
            </Button>
          ) : (
            <Button onClick={handleStartClick} size="sm" className="min-w-0 flex-1">
              <Play className="h-4 w-4 mr-1" />
              Start
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-2.5"
            aria-label={`Add past time to ${task.name}`}
            title="Add time that already happened"
            onClick={(e) => {
              e.stopPropagation();
              setLogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <LogPastDialog
          open={logOpen}
          onOpenChange={setLogOpen}
          taskId={task.id}
          taskName={task.name}
        />
      </CardContent>
    </Card>
  );
}
