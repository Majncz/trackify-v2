#!/usr/bin/env node
/**
 * Exit 0 if SQLite dev.db has at least one user; exit 1 if zero users.
 * Used by local-dev.mjs to decide whether to run seed:test-user:sqlite.
 *
 * Requires Prisma client generated for SQLite (`prisma generate` with schema.sqlite.prisma).
 */
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = "file:./dev.db";

const prisma = new PrismaClient();

try {
  const n = await prisma.user.count();
  process.exit(n === 0 ? 1 : 0);
} catch (e) {
  console.error("sqlite-has-users:", e);
  process.exit(2);
} finally {
  await prisma.$disconnect();
}
