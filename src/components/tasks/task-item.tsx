"use client";

import type { CSSProperties, MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationWords, cn } from "@/lib/utils";
import { resolveGroupAccent, hexToRgba } from "@/lib/group-accent";
import { Play, Square } from "lucide-react";

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
}

function taskCardChrome(accent: string | null): { className: string; style?: CSSProperties } {
  const layout =
    "transition-[box-shadow,border-color] h-full flex flex-col cursor-pointer rounded-xl bg-card text-card-foreground shadow-sm";
  if (!accent) {
    return { className: cn(layout, "border border-border") };
  }
  // One thin border; prominence from saturation (alpha), not extra ring thickness
  return {
    className: cn(layout, "border"),
    style: {
      borderColor: hexToRgba(accent, 0.9),
      boxShadow: `0 11px 34px -10px ${hexToRgba(accent, 0.52)}`,
    },
  };
}

export function TaskItem({
  task,
  isActive,
  onStart,
  onStop,
  isLoading,
  pendingConfirmation,
}: TaskItemProps) {
  const router = useRouter();
  const group = task.taskGroup ?? null;
  const accentHex = group ? resolveGroupAccent({ id: group.id, color: group.color }) : null;
  const chrome = taskCardChrome(accentHex);
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
        chrome.className,
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background z-0",
        pendingConfirmation &&
          "animate-pending-pulse ring-2 ring-yellow-500 ring-offset-2 ring-offset-background"
      )}
      style={chrome.style}
      onClick={handleCardClick}
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
              {isLoading ? "Saving..." : pendingConfirmation ? "Syncing..." : "Stop"}
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
