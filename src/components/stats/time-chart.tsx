"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
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
  endOfDay,
  endOfWeek,
  subDays,
  format,
  eachDayOfInterval,
  addHours,
  addDays,
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

type Duration = "weekly" | "yearly";

interface ChartDataPoint {
  label: string;
  [taskName: string]: number | string;
}

// Calculate how much of an event falls within a given interval
function getOverlapDuration(
  eventFrom: Date,
  eventTo: Date,
  intervalStart: Date,
  intervalEnd: Date
): number {
  // No overlap if event ends before interval starts or starts after interval ends
  if (eventTo <= intervalStart || eventFrom >= intervalEnd) {
    return 0;
  }
  
  // Calculate overlap
  const overlapStart = eventFrom > intervalStart ? eventFrom : intervalStart;
  const overlapEnd = eventTo < intervalEnd ? eventTo : intervalEnd;
  
  return Math.max(0, overlapEnd.getTime() - overlapStart.getTime());
}

export function TimeChart() {
  const { tasks, isLoading } = useTasks();
  const [duration, setDuration] = useState<Duration>("weekly");
  const [offset, setOffset] = useState(0);

  const visibleTasks = useMemo(
    () => tasks.filter((t) => !t.hidden),
    [tasks]
  );

  // Calculate max Y value for weekly view (not used for yearly)
  const maxYWeekly = useMemo(() => {
    const allEvents = visibleTasks.flatMap((t) =>
      t.events.map((e) => ({ 
        ...e, 
        from: new Date(e.from),
        to: new Date(e.to)
      }))
    );

    if (allEvents.length === 0) {
      return 10;
    }

    const totals = new Map<string, number>();
    
    allEvents.forEach((event) => {
      const eventFrom = event.from;
      const eventTo = event.to;
      
      let currentDate = new Date(eventFrom);
      while (currentDate <= eventTo) {
        const intervalStart = startOfDay(currentDate);
        const intervalEnd = new Date(endOfDay(currentDate).getTime() + 1);
        const key = format(intervalStart, "yyyy-MM-dd");
        
        const overlap = getOverlapDuration(eventFrom, eventTo, intervalStart, intervalEnd);
        if (overlap > 0) {
          totals.set(key, (totals.get(key) || 0) + overlap);
        }
        
        currentDate = intervalEnd;
      }
    });
    
    const maxMs = Math.max(...Array.from(totals.values()), 0);
    const maxHours = maxMs / 3600000;
    
    if (maxHours <= 1) return 1;
    if (maxHours <= 2) return 2;
    if (maxHours <= 5) return 5;
    if (maxHours <= 10) return 10;
    if (maxHours <= 24) return 24;
    if (maxHours <= 50) return 50;
    if (maxHours <= 100) return 100;
    return Math.ceil(maxHours / 50) * 50;
  }, [visibleTasks]);

  // Calculate date range and chart data (only used for weekly view, not yearly)
  const { chartData, dateLabel, topTasks, hasOther } = useMemo(() => {
    if (duration !== "weekly") {
      return { chartData: [], dateLabel: "", topTasks: [], hasOther: false };
    }

    const now = new Date();
    const baseEnd = startOfDay(now);
    const rangeEnd = endOfDay(subDays(baseEnd, offset * 5));
    const rangeStart = startOfDay(subDays(rangeEnd, 9)); // 10-day window
    const intervals = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
    const labelFormat = "EEE";
    const dateLabel = `${format(rangeStart, "MMM d")} - ${format(rangeEnd, "MMM d, yyyy")}`;

    // Calculate total time per task in this period (with proper overlap calculation)
    const taskTotals: { id: string; name: string; total: number }[] = visibleTasks.map((task) => {
      let total = 0;
      task.events.forEach((event) => {
        const eventFrom = new Date(event.from);
        const eventTo = new Date(event.to);
        const overlap = getOverlapDuration(eventFrom, eventTo, rangeStart, rangeEnd);
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
      const intervalStart = startOfDay(interval);
      const intervalEnd = new Date(endOfDay(interval).getTime() + 1);

      // Add top tasks
      topTasks.forEach((taskInfo) => {
        const task = visibleTasks.find((t) => t.id === taskInfo.id);
        if (!task) return;

        let taskTime = 0;
        task.events.forEach((event) => {
          const eventFrom = new Date(event.from);
          const eventTo = new Date(event.to);
          taskTime += getOverlapDuration(eventFrom, eventTo, intervalStart, intervalEnd);
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
            const eventFrom = new Date(event.from);
            const eventTo = new Date(event.to);
            otherTime += getOverlapDuration(eventFrom, eventTo, intervalStart, intervalEnd);
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

  type WeekGridCell = { totalMinutes: number; taskMinutes: Record<string, number> };

  // Load 1000 days (~2.7 years) of history for the scrollable days view
  const DAYS_TO_LOAD = 1000;

  // Pre-index events by date for O(1) lookup instead of O(events) per cell
  const eventsByDate = useMemo(() => {
    const index: Map<string, Array<{ taskName: string; from: Date; to: Date }>> = new Map();
    
    visibleTasks.forEach((task) => {
      task.events.forEach((event) => {
        const eventFrom = new Date(event.from);
        const eventTo = new Date(event.to);
        
        // Add to each day this event spans
        let current = startOfDay(eventFrom);
        while (current <= eventTo) {
          const key = format(current, "yyyy-MM-dd");
          if (!index.has(key)) index.set(key, []);
          index.get(key)!.push({ taskName: task.name, from: eventFrom, to: eventTo });
          current = addHours(current, 24);
        }
      });
    });
    
    return index;
  }, [visibleTasks]);

  const weekViewData = useMemo(() => {
    if (duration !== "weekly") return null;

    const now = new Date();
    const rangeEnd = endOfDay(now);
    const rangeStart = startOfDay(subDays(now, DAYS_TO_LOAD - 1));
    const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

    const grid: WeekGridCell[][] = [];
    let maxMinutes = 0;
    let hasData = false;

    days.forEach((day, dayIndex) => {
      grid[dayIndex] = [];
      const dayKey = format(day, "yyyy-MM-dd");
      const dayEvents = eventsByDate.get(dayKey) || [];

      for (let hour = 0; hour < 24; hour++) {
        const hourStart = addHours(startOfDay(day), hour);
        const hourEnd = addHours(hourStart, 1);

        const cell: WeekGridCell = { totalMinutes: 0, taskMinutes: {} };

        // Only check events for this specific day
        dayEvents.forEach(({ taskName, from, to }) => {
          const overlap = getOverlapDuration(from, to, hourStart, hourEnd);
          if (overlap > 0) {
            const minutes = overlap / 60000;
            cell.totalMinutes += minutes;
            cell.taskMinutes[taskName] = (cell.taskMinutes[taskName] || 0) + minutes;
          }
        });

        if (cell.totalMinutes > 0) {
          hasData = true;
          maxMinutes = Math.max(maxMinutes, cell.totalMinutes);
        }

        grid[dayIndex][hour] = cell;
      }
    });

    return {
      days,
      grid,
      maxMinutes: maxMinutes || 1,
      hasData,
    };
  }, [duration, eventsByDate]);

  // Yearly view data: group all days into weeks (GitHub calendar style)
  const yearlyViewData = useMemo(() => {
    if (duration !== "yearly") return null;

    const allEvents = visibleTasks.flatMap((t) =>
      t.events.map((e) => ({
        ...e,
        from: new Date(e.from),
        to: new Date(e.to),
      }))
    );

    if (allEvents.length === 0) {
      return null;
    }

    // Find the earliest date
    const eventDates = allEvents.flatMap((e) => [
      e.from,
      e.to,
    ]);
    const earliestDate = new Date(Math.min(...eventDates.map((d) => d.getTime())));
    const today = endOfDay(new Date());

    // Start from the earliest date, align to Monday
    const startDate = startOfWeek(startOfDay(earliestDate), { weekStartsOn: 1 });
    // End at today, align to Sunday
    const endDate = endOfWeek(today, { weekStartsOn: 1 });

    // Generate all days
    const allDays = eachDayOfInterval({ start: startDate, end: endDate });

    // Group days into weeks (columns) - ensure each week has exactly 7 days
    const weeks: Date[][] = [];
    let currentWeekStart = startDate;
    
    while (currentWeekStart <= endDate) {
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const day = addDays(currentWeekStart, i);
        if (day <= endDate && day >= startDate) {
          week.push(day);
        } else {
          // Pad with null/empty days for incomplete weeks
          week.push(day);
        }
      }
      weeks.push(week);
      currentWeekStart = addDays(weekEnd, 1);
    }

    // Calculate total minutes per day
    const dayMinutes = new Map<string, number>();
    allDays.forEach((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      const dayEvents = eventsByDate.get(dayKey) || [];
      let totalMinutes = 0;
      dayEvents.forEach(({ from, to }) => {
        const dayStart = startOfDay(day);
        const dayEnd = endOfDay(day);
        const overlap = getOverlapDuration(from, to, dayStart, dayEnd);
        totalMinutes += overlap / 60000;
      });
      dayMinutes.set(dayKey, totalMinutes);
    });

    // Build grid: 7 rows (Mon-Sun) x N columns (weeks)
    // Order: oldest week (Week 1) on the left, newest (today) on the right
    const grid: number[][] = [];
    let maxMinutes = 0;

    // Initialize grid with 7 rows
    for (let row = 0; row < 7; row++) {
      grid[row] = [];
    }

    // Fill grid: weeks in chronological order (oldest to newest)
    weeks.forEach((week, weekIdx) => {
      week.forEach((day, dayIdx) => {
        // dayIdx is already 0-6 (Mon-Sun)
        const dayKey = format(day, "yyyy-MM-dd");
        const minutes = dayMinutes.get(dayKey) || 0;
        grid[dayIdx][weekIdx] = minutes;
        maxMinutes = Math.max(maxMinutes, minutes);
      });
    });

    return {
      weeks,
      grid,
      maxMinutes: maxMinutes || 1,
      startDate,
      endDate,
    };
  }, [duration, eventsByDate, visibleTasks]);

  // Scroll refs for weekly and yearly views
  const weeklyScrollRef = useRef<HTMLDivElement>(null);
  const yearlyScrollRef = useRef<HTMLDivElement>(null);

  const scrollUp = useCallback(() => {
    weeklyScrollRef.current?.scrollBy({ top: -120, behavior: "smooth" });
  }, []);

  const scrollDown = useCallback(() => {
    weeklyScrollRef.current?.scrollBy({ top: 120, behavior: "smooth" });
  }, []);

  const scrollLeft = useCallback(() => {
    yearlyScrollRef.current?.scrollBy({ left: -120, behavior: "smooth" });
  }, []);

  const scrollRight = useCallback(() => {
    yearlyScrollRef.current?.scrollBy({ left: 120, behavior: "smooth" });
  }, []);

  function handlePrev() {
    if (duration === "weekly") {
      scrollUp();
    } else if (duration === "yearly") {
      scrollLeft();
    } else {
      setOffset((prev) => prev + 1);
    }
  }

  function handleNext() {
    if (duration === "weekly") {
      scrollDown();
    } else if (duration === "yearly") {
      scrollRight();
    } else if (offset > 0) {
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
  const hasData =
    duration === "weekly"
      ? weekViewData?.hasData ?? false
      : duration === "yearly"
      ? yearlyViewData !== null
      : topTasks.length > 0;

  const durations: Duration[] = ["weekly", "yearly"];
  const durationLabels: Record<Duration, string> = {
    weekly: "Weekly",
    yearly: "Yearly",
  };

  // For weekly view, show a static label since it's scrollable
  const weeklyDateLabel = weekViewData
    ? `${format(weekViewData.days[0], "MMM d")} - ${format(weekViewData.days[weekViewData.days.length - 1], "MMM d, yyyy")}`
    : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-base">Time Spent</CardTitle>
          <div className="flex items-center gap-2">
            {durations.map((d) => (
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
                {durationLabels[d]}
              </Button>
            ))}
          </div>
        </div>
        {duration === "weekly" ? (
          <div className="flex items-center justify-between mt-2">
            <Button variant="ghost" size="sm" onClick={scrollUp}>
              <ChevronUp className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">{weeklyDateLabel}</span>
            <Button variant="ghost" size="sm" onClick={scrollDown}>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        ) : duration === "yearly" ? (
          <div className="flex items-center justify-between mt-2">
            <Button variant="ghost" size="sm" onClick={scrollLeft}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">Yearly Calendar</span>
            <Button variant="ghost" size="sm" onClick={scrollRight}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
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
        )}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-64 flex items-center justify-center">
            <p className="text-muted-foreground">No data for this period</p>
          </div>
        ) : duration === "weekly" && weekViewData ? (
          <WeekCalendarView
            data={weekViewData}
            taskColors={taskColors}
            hasOther={hasOther}
            scrollRef={weeklyScrollRef}
          />
        ) : duration === "yearly" && yearlyViewData ? (
          <YearlyCalendarView data={yearlyViewData} scrollRef={yearlyScrollRef} />
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
                  domain={[0, maxYWeekly]}
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

interface WeekCalendarViewProps {
  data: {
    days: Date[];
    grid: { totalMinutes: number; taskMinutes: Record<string, number> }[][];
    maxMinutes: number;
    hasData: boolean;
  };
  taskColors: Record<string, string>;
  hasOther: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
}

const WEEKLY_SQUARE_SIZE = 12; // Fixed square size for weekly view
const WEEKLY_GAP = 2; // Gap between squares
const WEEKLY_CONTAINER_HEIGHT = 240;
const WEEKLY_BUFFER_ROWS = 5;
const WEEKLY_LABEL_WIDTH = 56; // 3.5rem in pixels

function WeekCalendarView({ data, taskColors, hasOther, scrollRef }: WeekCalendarViewProps) {
  const displayDays = data.days;
  const displayGrid = data.grid;
  
  // Measure container width to calculate how many squares fit
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Calculate grid dimensions
  const availableWidth = Math.max(0, containerWidth - WEEKLY_LABEL_WIDTH - 16); // subtract label and padding
  const squaresPerHour = Math.max(1, Math.floor(availableWidth / (24 * (WEEKLY_SQUARE_SIZE + WEEKLY_GAP))));
  const totalSquaresPerRow = 24 * squaresPerHour;
  const actualSquareSize = Math.floor((availableWidth - (totalSquaresPerRow - 1) * WEEKLY_GAP) / totalSquaresPerRow);
  const rowHeight = actualSquareSize + WEEKLY_GAP + 4; // square + gap + padding
  
  const totalRows = displayDays.length;
  const totalHeight = totalRows * rowHeight;
  
  const initialScrollTop = Math.max(0, totalHeight - WEEKLY_CONTAINER_HEIGHT);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);

  useEffect(() => {
    if (scrollRef.current && totalRows > 0) {
      const syncScroll = () => {
        if (scrollRef.current) {
          const targetScroll = Math.max(0, totalHeight - WEEKLY_CONTAINER_HEIGHT);
          if (Math.abs(scrollRef.current.scrollTop - targetScroll) > 1) {
            scrollRef.current.scrollTop = targetScroll;
            setScrollTop(targetScroll);
          }
        }
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(syncScroll);
      });
      const t1 = setTimeout(syncScroll, 50);
      const t2 = setTimeout(syncScroll, 200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [scrollRef, totalRows, totalHeight]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Non-linear intensity scale
  const getOpacity = (value: number, max: number) => {
    if (value <= 0) return 0.7; // More visible gray squares for weekly view
    const intensity = value / max;
    const scaled = Math.pow(intensity, 0.4);
    return 0.2 + scaled * 0.8;
  };

  const legendItems = Object.entries(taskColors);

  // Virtualization
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - WEEKLY_BUFFER_ROWS);
  const visibleCount = Math.ceil(WEEKLY_CONTAINER_HEIGHT / rowHeight) + WEEKLY_BUFFER_ROWS * 2;
  const endIdx = Math.min(totalRows, startIdx + visibleCount);
  const paddingTop = startIdx * rowHeight;

  const visibleDays = displayDays.slice(startIdx, endIdx);
  const visibleGrid = displayGrid.slice(startIdx, endIdx);

  // Use the larger of calculated or minimum size
  const cellSize = Math.max(WEEKLY_SQUARE_SIZE, actualSquareSize);

  return (
    <div className="space-y-3 w-full" ref={containerRef}>
      {/* Hour labels */}
      <div
        className="grid"
        style={{ gridTemplateColumns: `${WEEKLY_LABEL_WIDTH}px 1fr` }}
      >
        <div />
        <div
          className="grid"
          style={{ 
            gridTemplateColumns: `repeat(24, ${cellSize * squaresPerHour + (squaresPerHour - 1) * WEEKLY_GAP}px)`,
            gap: `${WEEKLY_GAP}px`,
          }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="text-[9px] text-muted-foreground text-center"
            >
              {h % 6 === 0 ? h : ""}
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable container */}
      <div
        ref={scrollRef}
        className="overflow-y-auto overflow-x-hidden"
        style={{ height: WEEKLY_CONTAINER_HEIGHT }}
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <div
            style={{ position: "absolute", top: paddingTop, left: 0, right: 0 }}
          >
            {visibleDays.map((day, localIdx) => {
              const globalIdx = startIdx + localIdx;
              return (
                <div
                  key={day.toISOString()}
                  className="grid items-center"
                  style={{ 
                    gridTemplateColumns: `${WEEKLY_LABEL_WIDTH}px 1fr`, 
                    height: rowHeight,
                    gap: `${WEEKLY_GAP}px`,
                  }}
                >
                  <span className="text-xs text-muted-foreground text-right whitespace-nowrap pr-2">
                    {format(day, "MMM d")}
                  </span>
                  <div
                    className="grid"
                    style={{ 
                      gridTemplateColumns: `repeat(${totalSquaresPerRow}, ${cellSize}px)`,
                      gap: `${WEEKLY_GAP}px`,
                    }}
                  >
                    {visibleGrid[localIdx].map((cell, hour) => {
                      const dominantTask = Object.entries(cell.taskMinutes).sort(
                        (a, b) => b[1] - a[1]
                      )[0]?.[0];
                      const baseColor =
                        (dominantTask && taskColors[dominantTask]) ||
                        (dominantTask ? OTHER_COLOR : "hsl(var(--muted))");

                      // Render multiple squares per hour based on squaresPerHour
                      return Array.from({ length: squaresPerHour }, (_, sqIdx) => (
                        <div
                          key={`${globalIdx}-${hour}-${sqIdx}`}
                          className="rounded-sm"
                          style={{
                            width: cellSize,
                            height: cellSize,
                            backgroundColor: baseColor,
                            opacity: getOpacity(cell.totalMinutes, data.maxMinutes),
                          }}
                          title={`${format(day, "EEE MMM d")} ${hour}:00 • ${Math.round(
                            cell.totalMinutes
                          )} min`}
                        />
                      ));
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {legendItems.length > 0 && (
        <div className="flex flex-wrap justify-center w-full gap-3 text-sm text-muted-foreground">
          {legendItems.map(([name, color]) => (
            <div key={name} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: color }}
              />
              <span>{name}</span>
            </div>
          ))}
          {hasOther && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: OTHER_COLOR }} />
              <span>Other</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface YearlyCalendarViewProps {
  data: {
    weeks: Date[][];
    grid: number[][];
    maxMinutes: number;
    startDate: Date;
    endDate: Date;
  };
  scrollRef: React.RefObject<HTMLDivElement>;
}

const CELL_SIZE = 12; // Size of each day cell in pixels
const GAP_SIZE = 2; // Gap between cells
const COLUMN_WIDTH = CELL_SIZE + GAP_SIZE; // Total width per week column

function YearlyCalendarView({ data, scrollRef }: YearlyCalendarViewProps) {
  const totalColumns = data.weeks.length;
  const totalWidth = totalColumns * COLUMN_WIDTH;

  // Auto-scroll to right (newest/current month) on mount
  useEffect(() => {
    if (scrollRef.current && totalColumns > 0) {
      const syncScroll = () => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(syncScroll);
      });
      const t1 = setTimeout(syncScroll, 50);
      const t2 = setTimeout(syncScroll, 200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [scrollRef, totalColumns]);

  // Non-linear intensity scale using power function
  // Power < 1 expands lower values for better differentiation
  const getOpacity = (value: number, max: number) => {
    if (value <= 0) return 0.15;
    const intensity = value / max;
    // Power of 0.4 gives good visual separation between low/medium/high
    const scaled = Math.pow(intensity, 0.4);
    return 0.2 + scaled * 0.8;
  };

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Calculate month labels with positions
  const monthLabels = useMemo(() => {
    const labels: { month: string; colIdx: number }[] = [];
    let lastMonth = "";
    
    data.weeks.forEach((week, colIdx) => {
      // Get the first day of this week that exists
      const firstDay = week[0];
      if (firstDay) {
        const monthName = format(firstDay, "MMM");
        if (monthName !== lastMonth) {
          labels.push({ month: monthName, colIdx });
          lastMonth = monthName;
        }
      }
    });
    
    return labels;
  }, [data.weeks]);

  return (
    <div className="w-full">
      <div className="grid" style={{ gridTemplateColumns: "2.5rem 1fr" }}>
        {/* Day labels - sticky on left */}
        <div className="flex flex-col pt-5">
          {dayLabels.map((dayLabel, idx) => (
            <div
              key={dayLabel}
              className="text-[9px] text-muted-foreground flex items-center"
              style={{ height: COLUMN_WIDTH }}
            >
              {idx % 2 === 0 ? dayLabel : ""}
            </div>
          ))}
        </div>

        {/* Scrollable container - full width */}
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden"
          style={{ width: "100%" }}
        >
          <div style={{ width: totalWidth, position: "relative" }}>
            {/* Month labels row */}
            <div style={{ height: 16, position: "relative" }}>
              {monthLabels.map(({ month, colIdx }) => (
                <span
                  key={`${month}-${colIdx}`}
                  className="text-[9px] text-muted-foreground absolute"
                  style={{ left: colIdx * COLUMN_WIDTH }}
                >
                  {month}
                </span>
              ))}
            </div>

            {/* Grid of day cells */}
            <div
              style={{
                display: "grid",
                gridTemplateRows: `repeat(7, ${CELL_SIZE}px)`,
                gridTemplateColumns: `repeat(${totalColumns}, ${CELL_SIZE}px)`,
                gap: `${GAP_SIZE}px`,
              }}
            >
              {dayLabels.map((_, rowIdx) => {
                return Array.from({ length: totalColumns }, (_, colIdx) => {
                  const minutes = data.grid[rowIdx]?.[colIdx] ?? 0;
                  const day = data.weeks[colIdx]?.[rowIdx];
                  return (
                    <div
                      key={`${colIdx}-${rowIdx}`}
                      className="rounded-sm"
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        backgroundColor: "#10b981",
                        opacity: getOpacity(minutes, data.maxMinutes),
                      }}
                      title={
                        day
                          ? `${format(day, "EEE MMM d")} • ${Math.round(minutes)} min`
                          : ""
                      }
                    />
                  );
                });
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
