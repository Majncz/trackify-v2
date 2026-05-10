import { GROUP_COLOR_PRESETS } from "./group-color-presets";

/**
 * Stable accent per group id for list chrome only (borders / pills).
 * Uses the same hues as GROUP_COLOR_PRESETS so Auto picks look like presets.
 */
function hashGroupId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(31, h) + id.charCodeAt(i);
  }
  return Math.abs(h);
}

export function groupAccentHex(groupId: string): string {
  return GROUP_COLOR_PRESETS[hashGroupId(groupId) % GROUP_COLOR_PRESETS.length]!;
}

/** Stable hue per task id (matches list chrome on Stats / billing sessions). */
export function taskAccentHex(taskId: string): string {
  return GROUP_COLOR_PRESETS[hashGroupId(taskId) % GROUP_COLOR_PRESETS.length]!;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Use saved group color when valid; otherwise stable hash from id. */
export function resolveGroupAccent(group: {
  id: string;
  color?: string | null;
}): string {
  const c = group.color?.trim();
  if (c && HEX_RE.test(c)) return c;
  return groupAccentHex(group.id);
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Soft fill behind group pill (hex + alpha). */
export function groupAccentSoftBg(hex: string, alpha = 0.14): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `color-mix(in srgb, ${hex} 14%, transparent)`;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
