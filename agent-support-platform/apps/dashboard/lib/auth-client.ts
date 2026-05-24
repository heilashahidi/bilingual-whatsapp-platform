// Client-side JWT cache. Fetches the raw session JWT from /api/me/token
// once, then reuses it until it expires. Tokens are signed by NextAuth
// when the user signs in; default expiry is 30 days.

let cached: { token: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // refetch at most every 5 minutes

export async function getClientAuthToken(): Promise<string | undefined> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.token;
  }
  try {
    const res = await fetch("/api/me/token", { credentials: "include" });
    if (!res.ok) {
      cached = null;
      return undefined;
    }
    const data = (await res.json()) as { token: string };
    cached = { token: data.token, fetchedAt: Date.now() };
    return data.token;
  } catch {
    return undefined;
  }
}
