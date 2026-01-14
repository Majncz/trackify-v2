"use client";

import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TimerDisplayProps {
  milliseconds: number;
  size?: "sm" | "md" | "lg" | "xl";
  onClick?: () => void;
  clickable?: boolean;
}

export function TimerDisplay({ milliseconds, size = "md", onClick, clickable = false }: TimerDisplayProps) {
  const formatted = formatDuration(milliseconds);

  const sizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
    xl: "text-6xl",
  };

  return (
    <span
      onClick={onClick}
      className={cn(
        "font-mono tabular-nums font-bold",
        sizeClasses[size],
        clickable && onClick && "cursor-pointer hover:opacity-80 transition-opacity"
      )}
      title={clickable ? "Click to adjust start time" : undefined}
    >
      {formatted}
    </span>
  );
}
