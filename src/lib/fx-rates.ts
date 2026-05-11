import { DEFAULT_BILLING_CURRENCY } from "./billing-currencies";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type RatesCacheEntry = {
  expiresAt: number;
  /** 1 unit of `base` equals `rates[target]` units of `target` */
  base: string;
  rates: Record<string, number>;
};

const ratesCache = new Map<string, RatesCacheEntry>();

function normCode(code: string): string {
  const c = code?.trim().toUpperCase().slice(0, 3);
  return c || DEFAULT_BILLING_CURRENCY;
}

function cacheKey(base: string, targetsSorted: string[]): string {
  return `${base}:${targetsSorted.join(",")}`;
}

/**
 * Fetch FX rates from Frankfurter (ECB). Cached in-memory per process.
 */
export async function fetchFrankfurterRates(
  base: string,
  targets: string[]
): Promise<Record<string, number> | null> {
  const b = normCode(base);
  const uniq = Array.from(
    new Set(targets.map(normCode).filter((t) => t !== b))
  ).sort();
  if (uniq.length === 0) return {};

  const key = cacheKey(b, uniq);
  const now = Date.now();
  const hit = ratesCache.get(key);
  if (hit && hit.expiresAt > now && hit.base === b) {
    const out: Record<string, number> = {};
    for (const t of uniq) {
      const r = hit.rates[t];
      if (r != null) out[t] = r;
    }
    if (Object.keys(out).length === uniq.length) return out;
  }

  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(
    b
  )}&to=${encodeURIComponent(uniq.join(","))}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      rates?: Record<string, number>;
    };
    if (!data.rates || typeof data.rates !== "object") return null;

    const merged: Record<string, number> = { ...data.rates };
    ratesCache.set(key, {
      base: b,
      rates: merged,
      expiresAt: now + CACHE_TTL_MS,
    });

    const out: Record<string, number> = {};
    for (const t of uniq) {
      const r = merged[t];
      if (typeof r !== "number" || !Number.isFinite(r)) return null;
      out[t] = r;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * How many units of `to` equal one unit of `from`.
 */
export async function getFxRate(
  fromCurrency: string,
  toCurrency: string
): Promise<number | null> {
  const f = normCode(fromCurrency);
  const t = normCode(toCurrency);
  if (f === t) return 1;

  const direct = await fetchFrankfurterRates(f, [t]);
  if (direct && direct[t] != null) return direct[t]!;

  // Try inverse via ECB: 1 f = ? t  ↔  1 t = ? f
  const inv = await fetchFrankfurterRates(t, [f]);
  if (inv && inv[f] != null && inv[f]! > 0) {
    return 1 / inv[f]!;
  }

  return null;
}

export async function convertAmountToCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<{ amount: number; rate: number } | null> {
  if (!Number.isFinite(amount)) return null;
  const rate = await getFxRate(fromCurrency, toCurrency);
  if (rate == null) return null;
  return { amount: amount * rate, rate };
}

/**
 * Build a map currencyCode -> multiplier to convert **into** `viewCurrency` (multiply native amount).
 */
export async function buildRatesToViewCurrency(
  viewCurrency: string,
  nativeCurrencies: string[]
): Promise<{ toView: Record<string, number>; missing: string[] }> {
  const view = normCode(viewCurrency);
  const codes = Array.from(
    new Set(nativeCurrencies.map(normCode).filter(Boolean))
  );

  const toView: Record<string, number> = {};
  const missing: string[] = [];

  for (const c of codes) {
    if (c === view) {
      toView[c] = 1;
      continue;
    }
    const r = await getFxRate(c, view);
    if (r == null) missing.push(c);
    else toView[c] = r;
  }

  return { toView, missing };
}
