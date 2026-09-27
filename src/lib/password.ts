import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

/** bcrypt, or the legacy unsalted SHA-256 hex hashes from older Trackify builds. */
export async function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  if (stored.startsWith("$2")) {
    return bcrypt.compare(password, stored);
  }
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const digest = createHash("sha256").update(password).digest("hex");
    return digest.toLowerCase() === stored.toLowerCase();
  }
  return false;
}

/** API tokens are stored as SHA-256 hex; clients keep the raw value. */
export function hashApiToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}
