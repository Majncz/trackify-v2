import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const s = seconds % 60;
  const m = minutes % 60;
  const h = hours;

  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatDurationWords(ms: number): string {
  if (ms === 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  // Less than a minute - show seconds
  if (hours === 0 && minutes === 0) return `${seconds}s`;
  
  // Less than an hour - show minutes (and seconds if relevant)
  if (hours === 0) return `${minutes}m`;
  
  // Hours only
  if (minutes === 0) return `${hours}h`;
  
  // Hours and minutes
  return `${hours}h ${minutes}m`;
}
