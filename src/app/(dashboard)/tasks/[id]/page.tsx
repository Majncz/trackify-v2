"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTasks } from "@/hooks/use-tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDurationWords } from "@/lib/utils";
import { ArrowLeft, EyeOff, Clock, Calendar } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, isToday, isYesterday, isSameDay } from "date-fns";

export default function TaskDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { tasks, isLoading, updateTask, deleteTask } = useTasks();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const task = tasks.find((t) => t.id === params.id);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-6">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Task not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalTime = task.events.reduce((sum, e) => {
    const fromMs = new Date(e.from).getTime();
    const toMs = new Date(e.to).getTime();
    return sum + (toMs - fromMs);
  }, 0);

  function handleEditClick() {
    if (!task) return;
    setEditName(task.name);
    setIsEditing(true);
  }

  function handleSave() {
    if (!task) return;
    if (editName.trim() && editName !== task.name) {
      updateTask.mutate({ id: task.id, name: editName.trim() });
    }
    setIsEditing(false);
  }

  function handleCancel() {
    if (!task) return;
    setEditName(task.name);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  }

  async function handleHide() {
    if (!task) return;
    if (confirm("Hide this task? You can restore it from Settings.")) {
      await deleteTask.mutateAsync(task.id);
      router.push("/");
    }
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        onClick={() => router.back()}
        className="flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">
              {isEditing ? (
                <Input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSave}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="text-xl font-semibold"
                />
              ) : (
                <span onClick={handleEditClick} className="cursor-pointer">
                  {task.name}
                </span>
              )}
            </CardTitle>
            {!isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleHide}
                disabled={deleteTask.isPending}
              >
                <EyeOff className="h-4 w-4 mr-2" />
                {deleteTask.isPending ? "Hiding..." : "Hide"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Total Time</p>
            <p className="text-2xl font-bold">
              {formatDurationWords(totalTime)}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-1">
              Tracking Sessions
            </p>
            <p className="text-lg font-semibold">{task.events.length}</p>
          </div>

          {task.events.length > 0 && (
            <EventsList events={task.events} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface Event {
  id: string;
  from: string;
  to: string;
  name: string;
}

function formatDayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMMM d, yyyy");
}

function EventsList({ events }: { events: Event[] }) {
  const [showAll, setShowAll] = useState(false);

  // Group events by day
  const groupedEvents = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => new Date(b.from).getTime() - new Date(a.from).getTime()
    );

    const groups: { date: Date; events: Event[]; totalMs: number }[] = [];

    for (const event of sorted) {
      const eventDate = new Date(event.from);
      const existingGroup = groups.find((g) => isSameDay(g.date, eventDate));

      const fromMs = new Date(event.from).getTime();
      const toMs = new Date(event.to).getTime();
      const duration = toMs - fromMs;

      if (existingGroup) {
        existingGroup.events.push(event);
        existingGroup.totalMs += duration;
      } else {
        groups.push({
          date: eventDate,
          events: [event],
          totalMs: duration,
        });
      }
    }

    return groups;
  }, [events]);

  const displayGroups = showAll ? groupedEvents : groupedEvents.slice(0, 5);
  const hasMore = groupedEvents.length > 5;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Time Entries
        </p>
        <Badge variant="secondary">{events.length} sessions</Badge>
      </div>

      <div className="space-y-4">
        {displayGroups.map((group) => (
          <div key={group.date.toISOString()} className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">
                {formatDayLabel(group.date)}
              </h4>
              <span className="text-xs text-muted-foreground">
                {formatDurationWords(group.totalMs)} total
              </span>
            </div>
            <div className="space-y-1.5">
              {group.events.map((event) => {
                const fromDate = new Date(event.from);
                const toDate = new Date(event.to);
                const duration = toDate.getTime() - fromDate.getTime();

                return (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                        <span className="text-sm font-medium">
                          {format(fromDate, "h:mm a")}
                        </span>
                        <span className="text-muted-foreground hidden sm:inline">→</span>
                        <span className="text-sm text-muted-foreground sm:text-foreground sm:font-medium">
                          {format(toDate, "h:mm a")}
                        </span>
                      </div>
                    </div>
                    <Badge variant="outline" className="font-mono">
                      {formatDurationWords(duration)}
                    </Badge>
                  </div>
                );
              })}
            </div>
            {displayGroups.indexOf(group) < displayGroups.length - 1 && (
              <Separator className="mt-3" />
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show Less" : `Show ${groupedEvents.length - 5} More Days`}
        </Button>
      )}
    </div>
  );
}
