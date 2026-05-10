"use client";

import type { RefObject, Ref } from "react";
import { useEffect, useMemo } from "react";
import { format } from "date-fns";
import type { YearlyContributionData } from "@/lib/yearly-contribution-data";
import { formatHeatMinutes } from "@/lib/format-heat-minutes";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const OTHER_COLOR = "#6b7280";

const CELL_SIZE = 12;
const GAP_SIZE = 2;
const COLUMN_WIDTH = CELL_SIZE + GAP_SIZE;

function DefaultYearlyHeatTooltipBody({
  day,
  minutes,
  taskMinutes,
  taskColors,
}: {
  day: Date;
  minutes: number;
  taskMinutes: Record<string, number>;
  taskColors: Record<string, string>;
}) {
  const dateStr = format(day, "EEEE, MMMM d, yyyy");
  const entries = Object.entries(taskMinutes).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-2 max-w-[260px] text-left">
      <div>
        <p className="text-sm font-semibold leading-tight">{dateStr}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Total for this calendar day
        </p>
      </div>
      <div className="border-t border-border pt-2 space-y-1.5">
        <p className="text-xs font-medium text-foreground">
          {formatHeatMinutes(minutes)} total
        </p>
        {entries.length > 0 && (
          <ul className="space-y-1">
            {entries.map(([name, mins]) => (
              <li key={name} className="flex items-start gap-2 text-xs">
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: taskColors[name] ?? OTHER_COLOR,
                  }}
                />
                <span className="min-w-0 leading-snug">
                  <span className="font-medium text-foreground">{name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatHeatMinutes(mins)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export type YearlyContributionCalendarProps = {
  data: YearlyContributionData;
  scrollRef: RefObject<HTMLDivElement | null>;
  taskColors: Record<string, string>;
  renderTooltip?: (ctx: {
    day: Date;
    minutes: number;
    dayKey: string;
    taskMinutes: Record<string, number>;
  }) => React.ReactNode;
  onDayClick?: (dayKey: string, day: Date) => void;
};

export function YearlyContributionCalendar({
  data,
  scrollRef,
  taskColors,
  renderTooltip,
  onDayClick,
}: YearlyContributionCalendarProps) {
  const totalColumns = data.weeks.length;
  const totalWidth = totalColumns * COLUMN_WIDTH;
  const todayKey = format(new Date(), "yyyy-MM-dd");

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

  const getOpacity = (value: number, max: number) => {
    if (value <= 0) return 0.15;
    const intensity = value / max;
    const scaled = Math.pow(intensity, 0.4);
    return 0.2 + scaled * 0.8;
  };

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const monthLabels = useMemo(() => {
    const labels: { month: string; colIdx: number }[] = [];
    let lastMonth = "";

    data.weeks.forEach((week, colIdx) => {
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

  const tooltipBody = (
    day: Date,
    minutes: number,
    dayKey: string,
    taskMinutes: Record<string, number>
  ) =>
    renderTooltip?.({ day, minutes, dayKey, taskMinutes }) ?? (
      <DefaultYearlyHeatTooltipBody
        day={day}
        minutes={minutes}
        taskMinutes={taskMinutes}
        taskColors={taskColors}
      />
    );

  const cells = dayLabels.flatMap((_, rowIdx) =>
    Array.from({ length: totalColumns }, (_, colIdx) => {
      const minutes = data.grid[rowIdx]?.[colIdx] ?? 0;
      const day = data.weeks[colIdx]?.[rowIdx];
      const dayKey = day ? format(day, "yyyy-MM-dd") : "";
      const taskMinutes = day ? data.dayTaskMinutes.get(dayKey) ?? {} : {};

      const cellStyle = {
        width: CELL_SIZE,
        height: CELL_SIZE,
        backgroundColor: "#10b981" as const,
        opacity: getOpacity(minutes, data.maxMinutes),
      };

      if (!day) {
        return (
          <div
            key={`${colIdx}-${rowIdx}`}
            className="rounded-sm"
            style={cellStyle}
          />
        );
      }

      const isFutureDay = dayKey > todayKey;
      const billingClick = Boolean(onDayClick) && !isFutureDay;

      if (minutes <= 0 && !billingClick) {
        return (
          <div
            key={`${colIdx}-${rowIdx}`}
            className="rounded-sm"
            style={cellStyle}
          />
        );
      }

      if (minutes <= 0 && billingClick) {
        return (
          <Tooltip key={`${colIdx}-${rowIdx}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-sm border-0 p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
                style={cellStyle}
                aria-label={format(day, "MMMM d, yyyy")}
                onClick={() => onDayClick!(dayKey, day)}
              />
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="border-border bg-popover p-3 shadow-lg"
            >
              {tooltipBody(day, minutes, dayKey, taskMinutes)}
            </TooltipContent>
          </Tooltip>
        );
      }

      return (
        <Tooltip key={`${colIdx}-${rowIdx}`}>
          <TooltipTrigger asChild>
            {billingClick ? (
              <button
                type="button"
                className="rounded-sm border-0 p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
                style={cellStyle}
                aria-label={format(day, "MMMM d, yyyy")}
                onClick={() => onDayClick!(dayKey, day)}
              />
            ) : (
              <button
                type="button"
                className="rounded-sm border-0 p-0 cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                style={cellStyle}
                aria-label={format(day, "MMMM d, yyyy")}
              />
            )}
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="border-border bg-popover p-3 shadow-lg"
          >
            {tooltipBody(day, minutes, dayKey, taskMinutes)}
          </TooltipContent>
        </Tooltip>
      );
    })
  );

  return (
    <div className="w-full">
      <div className="grid" style={{ gridTemplateColumns: "2.5rem 1fr" }}>
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

        <div
          ref={scrollRef as Ref<HTMLDivElement>}
          className="overflow-x-auto overflow-y-hidden"
          style={{ width: "100%" }}
        >
          <div style={{ width: totalWidth, position: "relative" }}>
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

            <div
              style={{
                display: "grid",
                gridTemplateRows: `repeat(7, ${CELL_SIZE}px)`,
                gridTemplateColumns: `repeat(${totalColumns}, ${CELL_SIZE}px)`,
                gap: `${GAP_SIZE}px`,
              }}
            >
              {cells}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
