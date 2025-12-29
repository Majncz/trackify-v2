"use client";

import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TimerDisplayProps {
  milliseconds: number;
  size?: "sm" | "md" | "lg" | "xl";
}

export function TimerDisplay({ milliseconds, size = "md" }: TimerDisplayProps) {
  const formatted = formatDuration(milliseconds);

  const sizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
    xl: "text-6xl",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums font-bold",
        sizeClasses[size]
      )}
    >
      {formatted}
    </span>
  );
}
