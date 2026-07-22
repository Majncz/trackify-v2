/** True when using file-based SQLite (`DATABASE_URL=file:…`). */
export function isSqliteFileDatabase(): boolean {
  return (process.env.DATABASE_URL ?? "").startsWith("file:");
}

/** Persist UI message parts: JSON column (Postgres) vs text (SQLite / Prisma 5). */
export function chatMessagePartsForDb(parts: unknown): unknown {
  if (parts == null) return undefined;
  if (isSqliteFileDatabase()) return JSON.stringify(parts);
  return parts;
}

/** Read stored parts back to structured data for API responses. */
export function chatMessagePartsFromDb(parts: unknown): unknown {
  if (parts == null) return null;
  if (typeof parts === "string") {
    try {
      return JSON.parse(parts) as unknown;
    } catch {
      return null;
    }
  }
  return parts;
}
