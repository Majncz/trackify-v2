import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived proof that a socket belongs to a signed-in user. The web fetches one
 * from /api/socket-ticket (session cookie) and sends it with `authenticate`; the
 * socket server never trusts a bare user id.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

function secret() {
  const s = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(`socket-ticket:${payload}`).digest("base64url");
}

export function createSocketTicket(userId: string, now = Date.now()) {
  const expiresAt = now + TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return { ticket: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifySocketTicket(ticket: unknown, now = Date.now()): string | null {
  if (typeof ticket !== "string" || ticket.length > 300) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  const expiresAt = Number(exp);
  if (!userId || !Number.isFinite(expiresAt) || expiresAt < now) return null;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}
