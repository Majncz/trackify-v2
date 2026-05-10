import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";

export function formatMoney(amount: number, currency: string): string {
  const raw =
    currency && currency.length >= 3
      ? currency.slice(0, 3).toUpperCase()
      : DEFAULT_BILLING_CURRENCY;
  const locale = raw === "CZK" ? "cs-CZ" : undefined;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: raw,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || DEFAULT_BILLING_CURRENCY}`;
  }
}

export function formatDurationMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}
