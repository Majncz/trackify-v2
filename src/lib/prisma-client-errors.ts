import { Prisma } from "@prisma/client";

/**
 * Maps Prisma engine errors to a short recovery hint for JSON APIs.
 */
export function prismaKnownRequestUserMessage(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (error.code) {
    case "P2022":
      return "Database is missing a column the app expects (often billingCadence). Apply schema updates: for Postgres run npm run setup:postgres (or prisma migrate deploy); for local SQLite run npm run setup:sqlite or npm run dev:local, then restart the server.";
    default:
      return null;
  }
}
