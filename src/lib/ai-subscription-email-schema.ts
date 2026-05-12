import { z } from "zod";

/**
 * Empty / whitespace → null; undefined preserves “omit field” on PATCH.
 * Zod v4: `.optional()` must wrap the whole `preprocess` — an inner optional does
 * not apply when the object key is omitted (only when passed as `undefined`).
 */
export const optionalBillingEmailSchema = z.preprocess(
  (v: unknown) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? null : t;
  },
  z.union([z.string().email().max(320), z.null()])
).optional();
