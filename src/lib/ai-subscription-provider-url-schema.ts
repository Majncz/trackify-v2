import { z } from "zod";

function normalizeProviderUrl(raw: string): string {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/**
 * Empty string → null (after optional `https://`); undefined = omit field on PATCH.
 * See `optionalBillingEmailSchema`: Zod v4 requires wrapping the whole preprocess in `.optional()`
 * so omitted object keys behave correctly.
 */
export const optionalBillingProviderUrlSchema = z.preprocess(
  (v: unknown) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? null : normalizeProviderUrl(t);
  },
  z.union([z.string().url().max(2048), z.null()])
).optional();
