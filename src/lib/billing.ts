import { formatInTimeZone } from "date-fns-tz";

const TZ_UTC = "UTC";

export function billingUtcDayKey(d: Date): string {
  return formatInTimeZone(d, TZ_UTC, "yyyy-MM-dd");
}

export function billingUtcMonthKey(d: Date): string {
  return formatInTimeZone(d, TZ_UTC, "yyyy-MM");
}

export function billingUtcIsoWeekKey(d: Date): string {
  return formatInTimeZone(d, TZ_UTC, "RRRR-'W'II");
}

/**
 * Raw duration in whole minutes between two dates (floor).
 */
export function durationMinutesRaw(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

export function computeEarnings(
  durationMinutes: number,
  hourlyRate: number
): number {
  if (durationMinutes <= 0 || hourlyRate <= 0) return 0;
  // Round to 2 decimal places for currency display consistency
  const v = (durationMinutes / 60) * hourlyRate;
  return Math.round(v * 100) / 100;
}

export type BillingTaskLike = {
  hourlyRate: number;
  /** Ignored for amounts; billing uses exact tracked whole minutes. Kept for API/DB compatibility. */
  roundingMins: number;
  currency: string;
};

export type BillingSessionRow = {
  id: string;
  from: string;
  to: string;
  name: string;
  taskId: string;
  taskName: string;
  /** Task workspace group (same as Stats); null if ungrouped. */
  taskGroup: {
    id: string;
    name: string;
    color?: string | null;
  } | null;
  hourlyRate: number;
  currency: string;
  rawDurationMinutes: number;
  durationMinutes: number;
  earnings: number;
  isPaid: boolean;
  paymentRecordId: string | null;
  paymentPaidAt: string | null;
  groupDay: string;
  groupWeek: string;
  groupMonth: string;
};

/**
 * Map a time entry + billing config to a session row.
 * When an event is paid and `paidAmount` is set, earnings reflect what was recorded at mark-paid (manual adjustments).
 */
export function eventToBillingSession(
  event: {
    id: string;
    from: Date;
    to: Date;
    name: string;
    taskId: string;
    paymentRecordId: string | null;
    paidAmount?: number | null;
  },
  taskName: string,
  billing: BillingTaskLike,
  paymentPaidAt: Date | null,
  taskGroup: BillingSessionRow["taskGroup"] = null
): BillingSessionRow {
  const raw = durationMinutesRaw(event.from, event.to);
  const durationMinutes = raw;
  const computedEarnings = computeEarnings(durationMinutes, billing.hourlyRate);
  const earnings =
    event.paymentRecordId != null && event.paidAmount != null
      ? Math.round(Number(event.paidAmount) * 100) / 100
      : computedEarnings;
  const from = event.from;
  return {
    id: event.id,
    from: event.from.toISOString(),
    to: event.to.toISOString(),
    name: event.name,
    taskId: event.taskId,
    taskName,
    taskGroup,
    hourlyRate: billing.hourlyRate,
    currency: billing.currency,
    rawDurationMinutes: raw,
    durationMinutes,
    earnings,
    isPaid: Boolean(event.paymentRecordId),
    paymentRecordId: event.paymentRecordId,
    paymentPaidAt: paymentPaidAt ? paymentPaidAt.toISOString() : null,
    groupDay: billingUtcDayKey(from),
    groupWeek: billingUtcIsoWeekKey(from),
    groupMonth: billingUtcMonthKey(from),
  };
}
