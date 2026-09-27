import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { verifyPassword } from "./password";
import { clientIp, rateClear, rateHit, rateLimited, LOGIN_FAILURES, LOGIN_WINDOW_MS } from "./rate-limit";

class InvalidEmail extends CredentialsSignin {
  code = "No account found with this email";
}

class InvalidPassword extends CredentialsSignin {
  code = "Incorrect password";
}

class TooManyAttempts extends CredentialsSignin {
  code = "Too many attempts. Please wait a few minutes and try again.";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const ip = request?.headers ? clientIp(request.headers) : "unknown";
        const rateKey = `login:${ip}:${String(credentials.email).toLowerCase()}`;
        if (rateLimited(rateKey, LOGIN_FAILURES, LOGIN_WINDOW_MS) || rateLimited(`loginip:${ip}`, 50, LOGIN_WINDOW_MS)) {
          throw new TooManyAttempts();
        }
        const fail = () => {
          rateHit(rateKey, LOGIN_WINDOW_MS);
          rateHit(`loginip:${ip}`, LOGIN_WINDOW_MS);
        };

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.password) {
          fail();
          throw new InvalidEmail();
        }

        const isValid = await verifyPassword(
          credentials.password as string,
          user.password
        );

        if (!isValid) {
          fail();
          throw new InvalidPassword();
        }
        rateClear(rateKey);

        return {
          id: user.id,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        if ("email" in user && typeof user.email === "string") {
          token.email = user.email;
        }
      } else if (typeof token.id === "string" && token.email == null) {
        const row = await prisma.user.findUnique({
          where: { id: token.id },
          select: { email: true },
        });
        if (row?.email) token.email = row.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;

      const tokenId = typeof token.id === "string" ? token.id : undefined;
      const tokenEmail =
        typeof token.email === "string" ? token.email.trim() : undefined;

      let row =
        tokenId != null
          ? await prisma.user.findUnique({
              where: { id: tokenId },
              select: { id: true, email: true },
            })
          : null;

      if (!row && tokenEmail) {
        row = await prisma.user.findUnique({
          where: { email: tokenEmail },
          select: { id: true, email: true },
        });
      }

      if (row) {
        session.user.id = row.id;
        session.user.email = row.email;
      } else if (tokenId) {
        session.user.id = tokenId;
      }

      return session;
    },
  },
});
