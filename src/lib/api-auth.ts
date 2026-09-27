import { auth } from "./auth";
import { prisma } from "./prisma";
import { hashApiToken } from "./password";

/** Native app tokens live this long and are renewed while in use. */
export const TOKEN_LIFETIME_DAYS = 90;
const RENEW_WHEN_LEFT_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Get authenticated user from either NextAuth session (web) or Bearer token (mobile)
 * Returns the user object or null if not authenticated
 * Accepts Request or NextRequest (NextRequest extends Request)
 */
export async function getAuthUser(request: Request) {
  // First, try NextAuth session (for web clients)
  const session = await auth();
  if (session?.user?.id) {
    // Prefer DB row by JWT id; if missing (new DB / re-seed / SQLite swap), fall back to email.
    let user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true },
    });
    if (
      !user &&
      session.user.email &&
      typeof session.user.email === "string"
    ) {
      const email = session.user.email.trim();
      if (email.length > 0) {
        user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true },
        });
      }
    }
    if (user) {
      return user;
    }
  }

  // Fall back to Bearer token authentication (for mobile clients)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    
    const apiToken = await prisma.apiToken.findUnique({
      where: { token: hashApiToken(token) },
      include: { user: { select: { id: true, email: true } } },
    });

    if (apiToken && apiToken.expiresAt > new Date()) {
      const now = Date.now();
      const renew = apiToken.expiresAt.getTime() - now < RENEW_WHEN_LEFT_MS;
      await prisma.apiToken.update({
        where: { id: apiToken.id },
        data: {
          lastUsedAt: new Date(now),
          ...(renew && {
            expiresAt: new Date(now + TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
          }),
        },
      }).catch(() => {
        // Ignore errors updating lastUsedAt - not critical
      });

      return apiToken.user;
    }
  }

  return null;
}
