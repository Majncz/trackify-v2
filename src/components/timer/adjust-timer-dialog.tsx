"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDuration } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTasks } from "@/hooks/use-tasks";

interface AdjustTimerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStartTime: number; // timestamp in milliseconds
  onAdjust: (newStartTime: number) => Promise<void>;
  onClearError?: () => void;
  isAdjusting?: boolean;
  error?: string | null;
}

interface Event {
  id: string;
  from: string;
  to: string;
  name: string;
  taskId: string;
}

const PRESET_OFFSETS = [
  { label: "-5 min", minutes: -5 },
  { label: "+5 min", minutes: 5 },
];

export function AdjustTimerDialog({
  open,
  onOpenChange,
  currentStartTime,
  onAdjust,
  onClearError,
  isAdjusting = false,
  error,
}: AdjustTimerDialogProps) {
  const [selectedStartTime, setSelectedStartTime] = useState<number>(currentStartTime);
  const [localError, setLocalError] = useState<string | null>(null);
  const [, forceUpdate] = useState(0); // For refreshing duration display
  const { tasks } = useTasks();
  const onClearErrorRef = useRef(onClearError);

  // Keep ref in sync
  useEffect(() => {
    onClearErrorRef.current = onClearError;
  }, [onClearError]);

  // Collect all events from all tasks for overlap checking
  const allEvents = useMemo(() => {
    const events: Array<Event & { taskName: string }> = [];
    tasks.forEach((task) => {
      task.events.forEach((event) => {
        events.push({
          ...event,
          taskName: task.name,
        });
      });
    });
    return events;
  }, [tasks]);

  // Helper function to check if a start time would overlap with existing events
  const checkOverlap = useCallback(
    (startTime: number): { overlaps: boolean; overlappingEvent?: Event & { taskName: string } } => {
      const now = Date.now();
      const newStart = startTime;
      const newEnd = now; // Timer extends to now
      const newDuration = newEnd - newStart;

      if (newDuration <= 0) {
        return { overlaps: true }; // Invalid duration counts as overlap
      }

      // Check each event for overlap
      // Two events overlap if: startA < endB AND startB < endA
      for (const event of allEvents) {
        const eventStart = new Date(event.from).getTime();
        const eventEnd = new Date(event.to).getTime();

        // Check if events overlap
        if (newStart < eventEnd && eventStart < newEnd) {
          return { overlaps: true, overlappingEvent: event };
        }
      }

      return { overlaps: false };
    },
    [allEvents]
  );

  // Check for overlaps with the selected start time
  const overlapError = useMemo(() => {
    if (selectedStartTime === currentStartTime) {
      return null;
    }

    const overlapCheck = checkOverlap(selectedStartTime);
    if (overlapCheck.overlaps && overlapCheck.overlappingEvent) {
      const event = overlapCheck.overlappingEvent;
      const eventStart = new Date(event.from).getTime();
      const eventEnd = new Date(event.to).getTime();
      const overlapStart = new Date(eventStart).toLocaleString();
      const durationMins = Math.round((eventEnd - eventStart) / 60000);
      return `Overlaps with "${event.taskName}: ${event.name}" (${overlapStart}, ${durationMins}min)`;
    }

    const now = Date.now();
    const newDuration = now - selectedStartTime;
    if (newDuration <= 0) {
      return "Invalid duration";
    }

    return null;
  }, [selectedStartTime, currentStartTime, checkOverlap]);

  // Check which preset buttons should be disabled
  // Check from the currently selected time, not the original start time
  const isPresetDisabled = useCallback(
    (minutes: number): boolean => {
      const newStartTime = selectedStartTime + minutes * 60 * 1000;
      const now = Date.now();
      
      // Disable if it would be in the future
      if (newStartTime > now) {
        return true;
      }
      
      // Disable if it would overlap with existing events
      return checkOverlap(newStartTime).overlaps;
    },
    [selectedStartTime, checkOverlap]
  );

  // Update selected time when dialog opens or currentStartTime changes
  useEffect(() => {
    if (open) {
      setSelectedStartTime(currentStartTime);
      setLocalError(null);
      // Clear any previous errors when dialog opens
      onClearErrorRef.current?.();
    }
  }, [open, currentStartTime]);

  // Keep duration display updated while dialog is open
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      forceUpdate((n) => n + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [open]);

  // Format datetime-local input value (YYYY-MM-DDTHH:mm)
  const getDateTimeLocalValue = (timestamp: number): string => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Parse datetime-local input value to timestamp
  const parseDateTimeLocalValue = (value: string): number => {
    return new Date(value).getTime();
  };

  const handlePresetClick = (minutes: number) => {
    // Calculate from the currently selected time, not the original start time
    // This allows users to click buttons multiple times to keep adjusting
    const newStartTime = selectedStartTime + minutes * 60 * 1000;
    // Don't allow future start times
    const now = Date.now();
    if (newStartTime > now) {
      setLocalError("Start time cannot be in the future");
      return;
    }
    setSelectedStartTime(newStartTime);
    setLocalError(null);
  };

  const handleDateTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!value) return;
    
    const newStartTime = parseDateTimeLocalValue(value);
    const now = Date.now();
    
    if (newStartTime > now) {
      setLocalError("Start time cannot be in the future");
      return;
    }
    
    setSelectedStartTime(newStartTime);
    setLocalError(null);
  };

  const handleApply = async () => {
    if (selectedStartTime === currentStartTime) {
      onOpenChange(false);
      return;
    }

    setLocalError(null);
    try {
      await onAdjust(selectedStartTime);
      onOpenChange(false);
    } catch {
      // Error is handled by parent component via adjustStartTimeError prop
    }
  };

  const newDuration = Date.now() - selectedStartTime;
  const currentDuration = Date.now() - currentStartTime;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Adjust Start Time</DialogTitle>
          <DialogDescription>
            Change when this timer started. The duration will update automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current start time display */}
          <div className="space-y-2">
            <Label>Started at</Label>
            <Input
              type="datetime-local"
              value={getDateTimeLocalValue(selectedStartTime)}
              onChange={handleDateTimeChange}
              disabled={isAdjusting}
            />
          </div>

          {/* Quick preset buttons */}
          <div className="space-y-2">
            <Label>Quick adjust</Label>
            <div className="flex gap-2">
              {PRESET_OFFSETS.map((preset) => {
                const isDisabled = isAdjusting || isPresetDisabled(preset.minutes);
                return (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePresetClick(preset.minutes)}
                    disabled={isDisabled}
                    title={
                      isPresetDisabled(preset.minutes)
                        ? preset.minutes > 0
                          ? "Cannot move start time forward beyond now"
                          : "This adjustment would overlap with an existing event"
                        : undefined
                    }
                  >
                    {preset.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Duration preview */}
          <div className="rounded-md bg-muted p-3 space-y-1">
            <div className="text-sm text-muted-foreground">New duration</div>
            <div className="text-lg font-mono font-semibold">
              {formatDuration(Math.max(0, newDuration))}
            </div>
            {selectedStartTime !== currentStartTime && (
              <div className="text-xs text-muted-foreground">
                {newDuration > currentDuration
                  ? `+${formatDuration(newDuration - currentDuration)}`
                  : `-${formatDuration(currentDuration - newDuration)}`}
              </div>
            )}
          </div>

          {/* Error display */}
          {(error || localError || overlapError) && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error || localError || overlapError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isAdjusting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isAdjusting || !!localError || !!overlapError}
          >
            {isAdjusting ? "Applying..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
