import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { isRetryablePrismaError, withPrismaRetry } from "./database";

// These tests cover the retry classifier + the single-retry helper
// without touching a real Prisma client. The $extends wiring on top of
// these is trivial plumbing.

describe("isRetryablePrismaError", () => {
  it("returns true for PrismaClientKnownRequestError P1001 (can't reach database)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Can't reach DB", {
      code: "P1001",
      clientVersion: "5.0.0",
    });
    expect(isRetryablePrismaError(err)).toBe(true);
  });

  it("returns true for P1017 (server has closed the connection)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("closed", {
      code: "P1017",
      clientVersion: "5.0.0",
    });
    expect(isRetryablePrismaError(err)).toBe(true);
  });

  it("returns false for a known error with a non-retryable code", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    expect(isRetryablePrismaError(err)).toBe(false);
  });

  it("returns true for the Neon-suspension E57P01 message text", () => {
    // Real Neon error surfaces as an unknown request error whose message
    // string contains the SqlState code. We match on the message.
    const err = new Error(
      "Error in PostgreSQL connection: ... code: SqlState(E57P01) ... terminating connection due to administrator command"
    );
    expect(isRetryablePrismaError(err)).toBe(true);
  });

  it("returns true for 'Server has closed the connection' phrasing", () => {
    const err = new Error("PostgresError: Server has closed the connection.");
    expect(isRetryablePrismaError(err)).toBe(true);
  });

  it("returns false for an arbitrary application error", () => {
    expect(isRetryablePrismaError(new Error("undefined is not a function"))).toBe(false);
  });

  it("returns false for non-error inputs (null, string, number)", () => {
    expect(isRetryablePrismaError(null)).toBe(false);
    expect(isRetryablePrismaError(undefined)).toBe(false);
    expect(isRetryablePrismaError("oops")).toBe(false);
    expect(isRetryablePrismaError(42)).toBe(false);
  });
});

describe("withPrismaRetry", () => {
  it("returns the result without retrying when the op succeeds first try", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    const result = await withPrismaRetry(op, 0);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds when the first call throws a retryable error", async () => {
    const transientErr = new Prisma.PrismaClientKnownRequestError("closed", {
      code: "P1017",
      clientVersion: "5.0.0",
    });
    const op = vi
      .fn()
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce("recovered");

    const result = await withPrismaRetry(op, 0);

    expect(result).toBe("recovered");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("rethrows the original error when the second attempt also fails", async () => {
    const transientErr = new Prisma.PrismaClientKnownRequestError("closed", {
      code: "P1017",
      clientVersion: "5.0.0",
    });
    const op = vi.fn().mockRejectedValue(transientErr);

    await expect(withPrismaRetry(op, 0)).rejects.toBe(transientErr);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry non-retryable errors — rethrows immediately", async () => {
    const fatalErr = new Prisma.PrismaClientKnownRequestError("dup key", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    const op = vi.fn().mockRejectedValue(fatalErr);

    await expect(withPrismaRetry(op, 0)).rejects.toBe(fatalErr);
    // Critical: NO second call. Retrying a unique-constraint violation
    // would mask a real application bug.
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries on the Neon E57P01 message string (unknown error path)", async () => {
    const neonErr = new Error(
      "PostgresError: terminating connection due to administrator command (E57P01)"
    );
    const op = vi
      .fn()
      .mockRejectedValueOnce(neonErr)
      .mockResolvedValueOnce({ id: "ticket-1" });

    const result = await withPrismaRetry(op, 0);

    expect(result).toEqual({ id: "ticket-1" });
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("waits the configured delay before retrying", async () => {
    const transientErr = new Prisma.PrismaClientKnownRequestError("x", {
      code: "P1001",
      clientVersion: "5.0.0",
    });
    const op = vi
      .fn()
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce("ok");

    const t0 = Date.now();
    await withPrismaRetry(op, 50);
    const elapsed = Date.now() - t0;

    // Should have waited at least ~50ms between the two attempts.
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
