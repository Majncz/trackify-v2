import { auth } from "./auth";
import { prisma } from "./prisma";

/**
 * Get authenticated user from either NextAuth session (web) or Bearer token (mobile)
 * Returns the user object or null if not authenticated
 * Accepts Request or NextRequest (NextRequest extends Request)
 */
export async function getAuthUser(request: Request) {
  // First, try NextAuth session (for web clients)
  const session = await auth();
  if (session?.user?.id) {
    // Return user from database to ensure consistency
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true },
    });
    if (user) {
      return user;
    }
  }

  // Fall back to Bearer token authentication (for mobile clients)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    
    const apiToken = await prisma.apiToken.findUnique({
      where: { token },
      include: { user: { select: { id: true, email: true } } },
    });

    if (apiToken && apiToken.expiresAt > new Date()) {
      // Update lastUsedAt
      await prisma.apiToken.update({
        where: { id: apiToken.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {
        // Ignore errors updating lastUsedAt - not critical
      });

      return apiToken.user;
    }
  }

  return null;
}
