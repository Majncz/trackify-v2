import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

class InvalidEmail extends CredentialsSignin {
  code = "No account found with this email";
}

class InvalidPassword extends CredentialsSignin {
  code = "Incorrect password";
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
      async authorize(credentials) {
        console.log("[AUTH] authorize called, credentials:", JSON.stringify(credentials));
        
        if (!credentials?.email || !credentials?.password) {
          console.log("[AUTH] Missing email or password");
          return null;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email as string },
          });
          console.log("[AUTH] User found:", !!user);

          if (!user || !user.password) {
            console.log("[AUTH] No user or no password");
            throw new InvalidEmail();
          }

          const isValid = await bcrypt.compare(
            credentials.password as string,
            user.password
          );
          console.log("[AUTH] Password valid:", isValid);

          if (!isValid) {
            throw new InvalidPassword();
          }

          return {
            id: user.id,
            email: user.email,
          };
        } catch (err) {
          console.log("[AUTH] Error:", err);
          throw err;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
