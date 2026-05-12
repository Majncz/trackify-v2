import {
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfDay,
} from "date-fns";
import { z } from "zod";

export const AI_BILLING_CADENCE_VALUES = [
  "monthly",
  "weekly",
  "quarterly",
  "yearly",
] as const;

export type AiBillingCadenceValue = (typeof AI_BILLING_CADENCE_VALUES)[number];

export const aiBillingCadenceZod = z.enum(AI_BILLING_CADENCE_VALUES);

export const AI_BILLING_CADENCE_DEFAULT: AiBillingCadenceValue = "monthly";

/** Stored on every row; spend metrics still treat recurring like monthly for now. */
export function normalizeAiBillingCadence(
  raw: string | null | undefined
): AiBillingCadenceValue {
  const parsed = aiBillingCadenceZod.safeParse(raw);
  return parsed.success ? parsed.data : AI_BILLING_CADENCE_DEFAULT;
}

export function aiBillingCadenceLabel(value: AiBillingCadenceValue): string {
  switch (value) {
    case "monthly":
      return "Monthly";
    case "weekly":
      return "Weekly";
    case "quarterly":
      return "Quarterly";
    case "yearly":
      return "Yearly";
    default:
      return value;
  }
}

function parseLocalYmdToDate(dateStr: string): Date | null {
  const trimmed = dateStr.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/**
 * Last calendar day of the coverage bucket that contains the start date.
 * Week = ISO-style block with Monday as week start (end Sunday).
 */
export function coveragePeriodEndYmd(
  startYmd: string,
  cadence: AiBillingCadenceValue
): string {
  const base = parseLocalYmdToDate(startYmd);
  if (!base) return startYmd.trim();
  const start = startOfDay(base);
  let end: Date;
  switch (cadence) {
    case "weekly":
      end = endOfWeek(start, { weekStartsOn: 1 });
      break;
    case "monthly":
      end = endOfMonth(start);
      break;
    case "quarterly":
      end = endOfQuarter(start);
      break;
    case "yearly":
      end = endOfYear(start);
      break;
    default:
      end = endOfMonth(start);
  }
  return format(end, "yyyy-MM-dd");
}
