import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import jsonwebtoken from "jsonwebtoken";

// Issues an HS256-signed JWT that the Express API can verify with the
// same NEXTAUTH_SECRET. The session cookie itself is JWE-encrypted (the
// NextAuth default) so the API can't read it directly — this endpoint
// is the bridge.

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

export async function GET(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfigured: NEXTAUTH_SECRET not set" },
      { status: 500 }
    );
  }

  // Verify the user has a valid session
  const sessionToken = await getToken({ req, secret });
  if (!sessionToken?.email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const apiToken = jsonwebtoken.sign(
    {
      email: sessionToken.email,
      name: sessionToken.name,
      userId: sessionToken.userId,
      role: sessionToken.role,
    },
    secret,
    { algorithm: "HS256", expiresIn: TOKEN_TTL_SECONDS }
  );

  return NextResponse.json({ token: apiToken, expiresIn: TOKEN_TTL_SECONDS });
}
