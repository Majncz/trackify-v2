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
import { formatDuration } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTasks } from "@/hooks/use-tasks";
import { cn } from "@/lib/utils";

interface AdjustTimerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStartTime: number;
  onSave: (session: { startTime: number; endTime: number | null }) => Promise<void>;
  onClearError?: () => void;
  isSaving?: boolean;
  error?: string | null;
}

interface Event {
  id: string;
  from: string;
  to: string;
  name: string;
  taskId: string;
}

type FocusField = "start" | "end" | "duration";

const MINUTE = 60 * 1000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toTimeValue(timestamp: number) {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateValue(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateAndTime(dateValue: string, timeValue: string, fallbackSeconds = 0) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  const next = new Date(year, month - 1, day, hours, minutes, fallbackSeconds, 0);
  return next.getTime();
}

function sameDay(a: number, b: number) {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function dayLabel(timestamp: number, now: number) {
  if (sameDay(timestamp, now)) return "Today";
  const yesterday = now - 24 * 60 * 60 * 1000;
  if (sameDay(timestamp, yesterday)) return "Yesterday";
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function AdjustTimerDialog({
  open,
  onOpenChange,
  currentStartTime,
  onSave,
  onClearError,
  isSaving = false,
  error,
}: AdjustTimerDialogProps) {
  const [startTime, setStartTime] = useState(currentStartTime);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [focus, setFocus] = useState<FocusField>("end");
  const [now, setNow] = useState(() => Date.now());
  const [localError, setLocalError] = useState<string | null>(null);
  const { tasks } = useTasks();
  const onClearErrorRef = useRef(onClearError);

  useEffect(() => {
    onClearErrorRef.current = onClearError;
  }, [onClearError]);

  const allEvents = useMemo(() => {
    const events: Array<Event & { taskName: string }> = [];
    tasks.forEach((task) => {
      task.events.forEach((event) => {
        events.push({ ...event, taskName: task.name });
      });
    });
    return events;
  }, [tasks]);

  const effectiveEnd = endTime ?? now;
  const durationMs = Math.max(0, effectiveEnd - startTime);
  const stillRunning = endTime == null;

  const checkOverlap = useCallback(
    (from: number, to: number) => {
      if (to <= from) return { overlaps: true as const };
      for (const event of allEvents) {
        const eventStart = new Date(event.from).getTime();
        const eventEnd = new Date(event.to).getTime();
        if (from < eventEnd && eventStart < to) {
          return { overlaps: true as const, event };
        }
      }
      return { overlaps: false as const };
    },
    [allEvents]
  );

  const overlapError = useMemo(() => {
    if (startTime === currentStartTime && stillRunning) return null;
    const overlap = checkOverlap(startTime, effectiveEnd);
    if (overlap.overlaps && "event" in overlap && overlap.event) {
      const event = overlap.event;
      const when = new Date(event.from).toLocaleString();
      return `Overlaps with “${event.taskName}: ${event.name}” (${when})`;
    }
    if (effectiveEnd <= startTime) return "End needs to be after start";
    if (startTime > now) return "Start cannot be in the future";
    if (endTime != null && endTime > now + 2000) return "End cannot be in the future";
    return null;
  }, [startTime, currentStartTime, stillRunning, checkOverlap, effectiveEnd, now, endTime]);

  useEffect(() => {
    if (!open) return;
    setStartTime(currentStartTime);
    setEndTime(null);
    setFocus("end");
    setLocalError(null);
    setNow(Date.now());
    onClearErrorRef.current?.();
  }, [open, currentStartTime]);

  useEffect(() => {
    if (!open || !stillRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, stillRunning]);

  const applyStart = (next: number) => {
    if (next > now) {
      setLocalError("Start cannot be in the future");
      return;
    }
    if (next >= effectiveEnd) {
      setLocalError("Start needs to be before the end");
      return;
    }
    setStartTime(next);
    setLocalError(null);
  };

  const applyEnd = (next: number | null) => {
    if (next == null) {
      setEndTime(null);
      setLocalError(null);
      return;
    }
    const clamped = Math.min(next, now);
    if (clamped <= startTime) {
      setLocalError("End needs to be after start");
      return;
    }
    setEndTime(clamped);
    setLocalError(null);
  };

  const pinEnd = () => {
    applyEnd(now);
    setFocus("end");
  };

  const setDurationMinutes = (totalMinutes: number) => {
    const next = Math.max(1, totalMinutes) * MINUTE;
    applyStart(effectiveEnd - next);
    setFocus("duration");
  };

  const nudge = (minutes: number) => {
    const delta = minutes * MINUTE;
    if (focus === "start") {
      applyStart(startTime + delta);
      return;
    }
    if (focus === "end") {
      applyEnd((endTime ?? now) + delta);
      return;
    }
    setDurationMinutes(Math.round(durationMs / MINUTE) + minutes);
  };

  const handleApply = async () => {
    if (stillRunning && startTime === currentStartTime) {
      onOpenChange(false);
      return;
    }
    setLocalError(null);
    try {
      await onSave({ startTime, endTime });
      onOpenChange(false);
    } catch {
      // Parent surfaces the mutation error
    }
  };

  const hours = Math.floor(durationMs / 3_600_000);
  const minutes = Math.floor((durationMs % 3_600_000) / MINUTE);
  const changed = startTime !== currentStartTime || !stillRunning;
  const applyLabel = stillRunning ? "Keep running" : `Stop at ${formatClock(effectiveEnd)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Edit this session</DialogTitle>
          <DialogDescription>
            Change when it started, or set when it should have ended. Apply keeps it
            running unless you pick an end time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setFocus("start")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setFocus("start");
              }}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                focus === "start" ? "border-primary bg-primary/5" : "bg-card"
              )}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Started
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{dayLabel(startTime, now)}</p>
              <Input
                type="time"
                value={toTimeValue(startTime)}
                onFocus={() => setFocus("start")}
                onChange={(e) => {
                  if (!e.target.value) return;
                  applyStart(fromDateAndTime(toDateValue(startTime), e.target.value));
                }}
                disabled={isSaving}
                className="mt-2 h-10 border-0 bg-transparent px-0 text-lg font-semibold shadow-none"
              />
              {!sameDay(startTime, now) && (
                <Input
                  type="date"
                  value={toDateValue(startTime)}
                  onFocus={() => setFocus("start")}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    applyStart(fromDateAndTime(e.target.value, toTimeValue(startTime)));
                  }}
                  disabled={isSaving}
                  className="mt-1 h-8 text-xs"
                />
              )}
            </div>

            <div className="flex items-center text-muted-foreground">→</div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (stillRunning) pinEnd();
                else setFocus("end");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  if (stillRunning) pinEnd();
                  else setFocus("end");
                }
              }}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                focus === "end" ? "border-primary bg-primary/5" : "bg-card"
              )}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Ended
              </p>
              {stillRunning ? (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">Still running</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">Now</p>
                  <p className="mt-1 text-xs text-muted-foreground">Tap to stop earlier</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">{dayLabel(endTime!, now)}</p>
                  <Input
                    type="time"
                    value={toTimeValue(endTime!)}
                    onFocus={() => setFocus("end")}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      applyEnd(fromDateAndTime(toDateValue(endTime!), e.target.value));
                    }}
                    disabled={isSaving}
                    className="mt-2 h-10 border-0 bg-transparent px-0 text-lg font-semibold shadow-none"
                  />
                  <button
                    type="button"
                    className="mt-1 text-xs text-primary hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyEnd(null);
                      setFocus("end");
                    }}
                  >
                    Back to now
                  </button>
                </>
              )}
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl border p-3",
              focus === "duration" ? "border-primary bg-primary/5" : "bg-muted/50"
            )}
            onClick={() => setFocus("duration")}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Duration
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={hours}
                onFocus={() => setFocus("duration")}
                onChange={(e) => {
                  const nextHours = Math.max(0, Number(e.target.value) || 0);
                  setDurationMinutes(nextHours * 60 + minutes);
                }}
                disabled={isSaving}
                className="h-10 w-14 text-center text-lg font-semibold"
              />
              <span className="text-sm text-muted-foreground">h</span>
              <Input
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                value={minutes}
                onFocus={() => setFocus("duration")}
                onChange={(e) => {
                  const nextMinutes = Math.min(59, Math.max(0, Number(e.target.value) || 0));
                  setDurationMinutes(hours * 60 + nextMinutes);
                }}
                disabled={isSaving}
                className="h-10 w-14 text-center text-lg font-semibold"
              />
              <span className="text-sm text-muted-foreground">m</span>
              <span className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {focus === "end"
                  ? "Nudges the end time"
                  : focus === "start"
                    ? "Nudges the start time"
                    : stillRunning
                      ? "Nudges how long you’ve been on this"
                      : "Nudges duration from the end"}
              </p>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => nudge(-5)}
                >
                  −5
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => nudge(5)}
                >
                  +5
                </Button>
              </div>
            </div>
          </div>

          {(error || localError || overlapError) && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error || localError || overlapError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isSaving || !!localError || !!overlapError}
          >
            {isSaving ? "Saving…" : changed ? applyLabel : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
