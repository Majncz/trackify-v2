/**
 * Small in-memory limiter for auth endpoints (single server process).
 * `hit` records an attempt; `blocked` says whether the key is over its budget.
 */
type Bucket = { count: number; resetAt: number };

const g = globalThis as typeof globalThis & { __trackifyRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__trackifyRate ??= new Map<string, Bucket>());

export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()) {
  const b = buckets.get(key);
  return Boolean(b && b.resetAt > now && b.count >= limit);
}

export function rateHit(key: string, windowMs: number, now = Date.now()) {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    b.count += 1;
  }
  if (buckets.size > 50_000) {
    buckets.forEach((v, k) => {
      if (v.resetAt <= now) buckets.delete(k);
    });
  }
}

export function rateClear(key: string) {
  buckets.delete(key);
}

export function clientIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURES = 10;

export function tooManyResponseBody() {
  return { error: "Too many attempts. Please wait a few minutes and try again." };
}
