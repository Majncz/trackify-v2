/** Empty + four work levels. Darkest is reserved for grind days. */
export const YEARLY_HEAT_COLORS = [
  "#e8eee9",
  "#86efac",
  "#22c55e",
  "#15803d",
  "#052e16",
] as const;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

export function workingDayMinutes(grid: number[][]): number[] {
  const values: number[] = [];
  for (const row of grid) {
    for (const minutes of row) {
      if (minutes > 0) values.push(minutes);
    }
  }
  values.sort((a, b) => a - b);
  return values;
}

/**
 * Map a day onto 0–4 so ordinary work stays mid-green and the longest
 * days jump to near-black. Hour floors plus top-quartile / top-decile
 * of actual working days.
 */
export function yearlyHeatLevel(
  minutes: number,
  workingSorted: number[]
): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;

  let level: 1 | 2 | 3 | 4 = 1;
  if (minutes >= 3 * 60) level = 2;
  if (minutes >= 5.5 * 60) level = 3;
  if (minutes >= 8 * 60) level = 4;

  if (workingSorted.length >= 8) {
    const p75 = percentile(workingSorted, 0.75);
    const p90 = percentile(workingSorted, 0.9);
    if (minutes >= p90 && p90 > 0) level = 4;
    else if (minutes >= p75 && p75 > 0) level = level < 3 ? 3 : level;
  }

  return level;
}

export function yearlyHeatColor(
  minutes: number,
  workingSorted: number[]
): string {
  return YEARLY_HEAT_COLORS[yearlyHeatLevel(minutes, workingSorted)];
}
