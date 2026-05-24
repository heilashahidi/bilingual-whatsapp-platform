import "server-only";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import jsonwebtoken from "jsonwebtoken";

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

// Issues an HS256 JWT for the Express API, using claims from the
// signed-in user's NextAuth session. Returns undefined if there's no
// valid session (e.g., the request is from an unauthenticated context).
//
// Server components call this and pass the result to lib/api fetchers.
export async function getServerApiToken(): Promise<string | undefined> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return undefined;

  // getToken expects Request-like args; synthesize one from next/headers +
  // next/cookies since App Router has no req object.
  const cookieHeader = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const host = headers().get("host") || "localhost:3000";

  const fakeReq = {
    cookies: cookies().getAll().reduce<Record<string, string>>((acc, c) => {
      acc[c.name] = c.value;
      return acc;
    }, {}),
    headers: { cookie: cookieHeader, host },
  } as Parameters<typeof getToken>[0]["req"];

  const sessionToken = await getToken({
    req: fakeReq,
    secret,
  });
  if (!sessionToken?.email) return undefined;

  return jsonwebtoken.sign(
    {
      email: sessionToken.email,
      name: sessionToken.name,
      userId: sessionToken.userId,
      role: sessionToken.role,
    },
    secret,
    { algorithm: "HS256", expiresIn: TOKEN_TTL_SECONDS }
  );
}
