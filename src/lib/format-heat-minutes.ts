/**
 * Shared duration formatting for heat tooltips (stats + billing).
 * Matches the stats time chart behavior.
 */
export function formatHeatMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0s";

  const secExact = totalMinutes * 60;
  const roundedWhole = Math.round(secExact);

  if (roundedWhole === 0 && secExact > 0) {
    const digits = secExact >= 0.1 ? 2 : secExact >= 0.01 ? 3 : 4;
    return `${parseFloat(secExact.toFixed(digits))}s`;
  }

  if (roundedWhole === 0) return "0s";

  const h = Math.floor(roundedWhole / 3600);
  const m = Math.floor((roundedWhole % 3600) / 60);
  const s = roundedWhole % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
