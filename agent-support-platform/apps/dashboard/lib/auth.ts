import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === "development",
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  session: { strategy: "jwt" },
  // Use NextAuth's default JWE encoding for the session cookie so
  // withAuth middleware can read it. A separate HS256 JWT is issued
  // for the Express API at /api/me/token (see app/api/me/token/route.ts).
  callbacks: {
    // Block sign-in for emails not on the InternalUser allowlist.
    async signIn({ user }) {
      if (!user.email) return false;
      try {
        const res = await fetch(
          `${API_URL}/api/users?email=${encodeURIComponent(user.email)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return false;
        const data = (await res.json()) as {
          users: Array<{ id: string; email: string; role: string }>;
        };
        return data.users.some(
          (u) => u.email.toLowerCase() === user.email!.toLowerCase()
        );
      } catch {
        return false;
      }
    },
    // Enrich the JWT with the InternalUser's id and role.
    async jwt({ token, user }) {
      if (user?.email) {
        try {
          const res = await fetch(
            `${API_URL}/api/users?email=${encodeURIComponent(user.email)}`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const data = (await res.json()) as {
              users: Array<{ id: string; name: string; email: string; role: string }>;
            };
            const match = data.users.find(
              (u) => u.email.toLowerCase() === user.email!.toLowerCase()
            );
            if (match) {
              token.userId = match.id;
              token.role = match.role;
              token.name = match.name;
            }
          }
        } catch {
          // If the API is unreachable at sign-in time, fall back to no role.
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string | undefined;
        (session.user as { role?: string }).role = token.role as string | undefined;
      }
      return session;
    },
  },
};
