import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function isSqliteUrl(url: string): boolean {
  return url.startsWith("file:");
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgresql:") || url.startsWith("postgres:");
}

/** Avoid ::1 when `localhost` resolves to IPv6 but the mapped port is IPv4-only. */
function normalizePostgresUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() === "localhost") {
      u.hostname = "127.0.0.1";
      return u.toString();
    }
  } catch {
    /* keep original */
  }
  return url;
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Examples: postgresql://… for Postgres, or file:./prisma/dev.db for local SQLite (run npm run setup:sqlite, then npm run dev:sqlite)."
    );
  }

  const log =
    process.env.NODE_ENV === "development"
      ? (["query", "error", "warn"] as const)
      : (["error"] as const);

  if (isSqliteUrl(url)) {
    return new PrismaClient({
      log: [...log],
    });
  }

  if (!isPostgresUrl(url)) {
    throw new Error(
      `DATABASE_URL must use file:, postgres:, or postgresql: (got: ${url.slice(0, 32)}…).`
    );
  }

  const pool = new Pool({
    connectionString: normalizePostgresUrl(url),
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: [...log],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
