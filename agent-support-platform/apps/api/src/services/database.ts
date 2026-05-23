import { PrismaClient, Prisma } from "@prisma/client";

// ─── Transient-error retry ────────────────────────────────────────────
//
// Neon's free tier auto-suspends the compute after ~5 minutes of idle.
// The first request after suspension fails with PG SqlState E57P01
// ("terminating connection due to administrator command") or one of
// Prisma's connection-related codes (P1001/P1002/P1017). Neon wakes
// the database in ~100–500 ms, so a single retry with a short backoff
// almost always succeeds.
//
// We export `isRetryablePrismaError` and `withPrismaRetry` separately
// so they can be unit-tested without spinning up a real Prisma client.

const RETRYABLE_CODES = new Set<string>([
  "P1001", // Can't reach database server
  "P1002", // Database server was reached but timed out
  "P1017", // Server has closed the connection
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  "terminating connection due to administrator command",
  "Server has closed the connection",
  "E57P01",
  "Can't reach database server",
];

export function isRetryablePrismaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  // Known Prisma errors carry a stable `.code`
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_CODES.has(err.code);
  }

  // Unknown / initialization errors only carry a message
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== "string") return false;
  return RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) => msg.includes(fragment));
}

export async function withPrismaRetry<T>(
  op: () => Promise<T>,
  retryDelayMs = 1500
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isRetryablePrismaError(err)) throw err;
    const msg = (err as Error).message?.slice(0, 100) ?? "(no message)";
    console.warn(
      `  ⚠ Prisma: transient error, retrying in ${retryDelayMs}ms — ${msg}`
    );
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return op();
  }
}

// ─── Wrapped Prisma client ────────────────────────────────────────────
//
// $extends wraps every model operation (findMany, create, update, …)
// in our retry helper. Operations on the $-namespace ($queryRaw,
// $transaction, $disconnect) are NOT auto-wrapped — they bypass the
// extension by design. The /health endpoint's $queryRaw and any future
// raw queries don't get the retry behavior; that's acceptable since
// /health already returns 503 on DB failure and any new raw query
// caller can wrap explicitly with withPrismaRetry().

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});

export const prisma = basePrisma.$extends({
  name: "neon-suspend-retry",
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        return withPrismaRetry(() => query(args));
      },
    },
  },
});
