"use client";

import { useState, useMemo } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
  endOfWeek,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
  format,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  eachHourOfInterval,
  startOfHour,
  subHours,
  addHours,
} from "date-fns";

// Curated color palette
const TASK_COLORS = [
  "#3b82f6", // blue
  "#f97316", // orange
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
];

const OTHER_COLOR = "#6b7280"; // gray for "Other"
const MAX_TASKS = 5;

type Duration = "hours" | "days" | "weeks" | "months";

interface ChartDataPoint {
  label: string;
  [taskName: string]: number | string;
}

// Calculate how much of an event falls within a given interval
function getOverlapDuration(
  eventStart: Date,
  eventDuration: number,
  intervalStart: Date,
  intervalEnd: Date
): number {
  const eventEnd = new Date(eventStart.getTime() + eventDuration);
  
  // No overlap if event ends before interval starts or starts after interval ends
  if (eventEnd <= intervalStart || eventStart >= intervalEnd) {
    return 0;
  }
  
  // Calculate overlap
  const overlapStart = eventStart > intervalStart ? eventStart : intervalStart;
  const overlapEnd = eventEnd < intervalEnd ? eventEnd : intervalEnd;
  
  return Math.max(0, overlapEnd.getTime() - overlapStart.getTime());
}

export function TimeChart() {
  const { tasks, isLoading } = useTasks();
  const [duration, setDuration] = useState<Duration>("days");
  const [offset, setOffset] = useState(0);

  const visibleTasks = useMemo(
    () => tasks.filter((t) => !t.hidden),
    [tasks]
  );

  // Calculate max Y value for each duration type (across ALL periods)
  const maxYByDuration = useMemo(() => {
    const allEvents = visibleTasks.flatMap((t) =>
      t.events.map((e) => ({ 
        ...e, 
        createdAt: new Date(e.createdAt),
        duration: e.duration 
      }))
    );

    if (allEvents.length === 0) {
      return { hours: 10, days: 10, weeks: 50, months: 200 };
    }

    // For each duration type, calculate max total per interval
    const calculateMax = (type: Duration): number => {
      const totals = new Map<string, number>();
      
      allEvents.forEach((event) => {
        const eventStart = event.createdAt;
        const eventEnd = new Date(eventStart.getTime() + event.duration);
        
        // Determine which intervals this event spans
        let currentDate = new Date(eventStart);
        while (currentDate <= eventEnd) {
          let intervalStart: Date;
          let intervalEnd: Date;
          let key: string;
          
          switch (type) {
            case "hours":
              intervalStart = startOfHour(currentDate);
              intervalEnd = addHours(intervalStart, 1);
              key = format(intervalStart, "yyyy-MM-dd-HH");
              break;
            case "days":
              intervalStart = startOfDay(currentDate);
              intervalEnd = new Date(endOfDay(currentDate).getTime() + 1);
              key = format(intervalStart, "yyyy-MM-dd");
              break;
            case "weeks":
              intervalStart = startOfWeek(currentDate, { weekStartsOn: 1 });
              intervalEnd = new Date(endOfWeek(currentDate, { weekStartsOn: 1 }).getTime() + 1);
              key = format(intervalStart, "yyyy-MM-dd");
              break;
            case "months":
              intervalStart = startOfMonth(currentDate);
              intervalEnd = new Date(endOfMonth(currentDate).getTime() + 1);
              key = format(intervalStart, "yyyy-MM");
              break;
          }
          
          const overlap = getOverlapDuration(eventStart, event.duration, intervalStart, intervalEnd);
          if (overlap > 0) {
            totals.set(key, (totals.get(key) || 0) + overlap);
          }
          
          // Move to next interval
          currentDate = intervalEnd;
        }
      });
      
      const maxMs = Math.max(...Array.from(totals.values()), 0);
      const maxHours = maxMs / 3600000;
      
      // Round up to nice number based on scale
      if (maxHours <= 1) return 1;
      if (maxHours <= 2) return 2;
      if (maxHours <= 5) return 5;
      if (maxHours <= 10) return 10;
      if (maxHours <= 24) return 24;
      if (maxHours <= 50) return 50;
      if (maxHours <= 100) return 100;
      return Math.ceil(maxHours / 50) * 50;
    };

    return {
      hours: calculateMax("hours"),
      days: Math.min(calculateMax("days"), 16), // Cap days at 16h for better visibility
      weeks: calculateMax("weeks"),
      months: calculateMax("months"),
    };
  }, [visibleTasks]);

  // Calculate date range and chart data
  const { chartData, dateLabel, topTasks, hasOther } = useMemo(() => {
    const now = new Date();
    let intervals: Date[] = [];
    let rangeStart: Date;
    let rangeEnd: Date;
    let labelFormat: string;
    let dateLabel: string;

    switch (duration) {
      case "hours": {
        const baseEnd = startOfHour(now);
        rangeEnd = subHours(baseEnd, offset * 24);
        rangeStart = subHours(rangeEnd, 23);
        intervals = eachHourOfInterval({ start: rangeStart, end: rangeEnd });
        labelFormat = "HH:mm";
        dateLabel = format(rangeStart, "MMM d, yyyy");
        break;
      }
      case "days": {
        const baseEnd = startOfDay(now);
        rangeEnd = endOfDay(subDays(baseEnd, offset * 7));
        rangeStart = startOfDay(subDays(rangeEnd, 6));
        intervals = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
        labelFormat = "EEE";
        dateLabel = `${format(rangeStart, "MMM d")} - ${format(rangeEnd, "MMM d, yyyy")}`;
        break;
      }
      case "weeks": {
        const baseEnd = startOfWeek(now, { weekStartsOn: 1 });
        rangeEnd = endOfWeek(subWeeks(baseEnd, offset * 10), { weekStartsOn: 1 });
        rangeStart = startOfWeek(subWeeks(rangeEnd, 9), { weekStartsOn: 1 });
        intervals = eachWeekOfInterval({ start: rangeStart, end: rangeEnd }, { weekStartsOn: 1 });
        labelFormat = "MMM d";
        dateLabel = `${format(rangeStart, "MMM d")} - ${format(rangeEnd, "MMM d, yyyy")}`;
        break;
      }
      case "months": {
        const baseEnd = startOfMonth(now);
        rangeEnd = endOfMonth(subMonths(baseEnd, offset * 12));
        rangeStart = startOfMonth(subMonths(rangeEnd, 11));
        intervals = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        labelFormat = "MMM";
        dateLabel = `${format(rangeStart, "MMM yyyy")} - ${format(rangeEnd, "MMM yyyy")}`;
        break;
      }
    }

    // Calculate total time per task in this period (with proper overlap calculation)
    const taskTotals: { id: string; name: string; total: number }[] = visibleTasks.map((task) => {
      let total = 0;
      task.events.forEach((event) => {
        const eventStart = new Date(event.createdAt);
        const overlap = getOverlapDuration(eventStart, event.duration, rangeStart, rangeEnd);
        total += overlap;
      });
      return { id: task.id, name: task.name, total };
    });

    // Filter to only tasks with data, sort by total, take top N
    const tasksWithData = taskTotals
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total);

    const topTasks = tasksWithData.slice(0, MAX_TASKS);
    const otherTasks = tasksWithData.slice(MAX_TASKS);
    const hasOther = otherTasks.length > 0;

    // Build chart data
    const data: ChartDataPoint[] = intervals.map((interval) => {
      const point: ChartDataPoint = { label: format(interval, labelFormat) };

      let intervalStart: Date;
      let intervalEnd: Date;

      switch (duration) {
        case "hours":
          intervalStart = interval;
          intervalEnd = addHours(interval, 1);
          break;
        case "days":
          intervalStart = startOfDay(interval);
          intervalEnd = new Date(endOfDay(interval).getTime() + 1);
          break;
        case "weeks":
          intervalStart = startOfWeek(interval, { weekStartsOn: 1 });
          intervalEnd = new Date(endOfWeek(interval, { weekStartsOn: 1 }).getTime() + 1);
          break;
        case "months":
          intervalStart = startOfMonth(interval);
          intervalEnd = new Date(endOfMonth(interval).getTime() + 1);
          break;
      }

      // Add top tasks
      topTasks.forEach((taskInfo) => {
        const task = visibleTasks.find((t) => t.id === taskInfo.id);
        if (!task) return;

        let taskTime = 0;
        task.events.forEach((event) => {
          const eventStart = new Date(event.createdAt);
          taskTime += getOverlapDuration(eventStart, event.duration, intervalStart, intervalEnd);
        });

        point[task.name] = Math.round((taskTime / 3600000) * 10) / 10;
      });

      // Add "Other" category
      if (hasOther) {
        let otherTime = 0;
        otherTasks.forEach((taskInfo) => {
          const task = visibleTasks.find((t) => t.id === taskInfo.id);
          if (!task) return;

          task.events.forEach((event) => {
            const eventStart = new Date(event.createdAt);
            otherTime += getOverlapDuration(eventStart, event.duration, intervalStart, intervalEnd);
          });
        });
        point["Other"] = Math.round((otherTime / 3600000) * 10) / 10;
      }

      return point;
    });

    return { chartData: data, dateLabel, topTasks, hasOther };
  }, [duration, offset, visibleTasks]);

  // Assign colors to top tasks
  const taskColors = useMemo(() => {
    const colors: Record<string, string> = {};
    topTasks.forEach((task, index) => {
      colors[task.name] = TASK_COLORS[index % TASK_COLORS.length];
    });
    if (hasOther) {
      colors["Other"] = OTHER_COLOR;
    }
    return colors;
  }, [topTasks, hasOther]);

  function handlePrev() {
    setOffset((prev) => prev + 1);
  }

  function handleNext() {
    if (offset > 0) {
      setOffset((prev) => prev - 1);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time Spent</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (visibleTasks.length === 0) {
    return null;
  }

  // Check if there's any data in this period
  const hasData = topTasks.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-base">Time Spent</CardTitle>
          <div className="flex items-center gap-2">
            {(["hours", "days", "weeks", "months"] as Duration[]).map((d) => (
              <Button
                key={d}
                variant={duration === d ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDuration(d);
                  setOffset(0);
                }}
                className="capitalize"
              >
                {d}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <Button variant="ghost" size="sm" onClick={handlePrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{dateLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNext}
            disabled={offset === 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-64 flex items-center justify-center">
            <p className="text-muted-foreground">No data for this period</p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <YAxis
                  domain={[0, maxYByDuration[duration]]}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}h`}
                  className="text-muted-foreground"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value) => [`${value}h`, undefined]}
                />
                <Legend
                  content={({ payload }) => (
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                      {payload?.map((entry, index) => (
                        <div key={index} className="flex items-center gap-1.5">
                          <div
                            className="w-3 h-3 rounded-sm"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-sm text-muted-foreground">
                            {entry.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                />
                {topTasks.map((task) => (
                  <Bar
                    key={task.id}
                    dataKey={task.name}
                    stackId="a"
                    fill={taskColors[task.name]}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
                {hasOther && (
                  <Bar
                    dataKey="Other"
                    stackId="a"
                    fill={OTHER_COLOR}
                    radius={[2, 2, 0, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
