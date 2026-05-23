import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/auth";

// Role-guard tests for PATCH /api/incidents/:id. The middleware fires
// in this order: requireAuth (verifies JWT, attaches req.user) →
// requireRole (checks role claim). We mount both so the role-claim
// path actually runs end-to-end with a real signed token.

vi.mock("../services/database", () => ({
  prisma: {
    incident: { update: vi.fn() },
  },
}));

import { incidentRouter } from "./incidents";
import { prisma } from "../services/database";

const update = prisma.incident.update as ReturnType<typeof vi.fn>;

const SECRET = "test-nextauth-secret";

function buildApp() {
  const app = express();
  app.use(express.json());
  // Real requireAuth + the router's built-in requireRole give us the
  // full middleware chain.
  app.use("/api/incidents", requireAuth, incidentRouter);
  return app;
}

function tokenFor(role: string | undefined) {
  const payload: Record<string, unknown> = {
    email: "operator@example.com",
    name: "Test Operator",
    userId: "user-1",
  };
  if (role !== undefined) payload.role = role;
  return jwt.sign(payload, SECRET, { algorithm: "HS256", expiresIn: "5m" });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Crucial: ensure DISABLE_AUTH is off so requireAuth + requireRole
  // both actually run. Other test files set DISABLE_AUTH=true at the
  // module level.
  delete process.env.DISABLE_AUTH;
  process.env.NEXTAUTH_SECRET = SECRET;
  update.mockResolvedValue({ id: "inc-1", status: "resolved" });
});

describe("PATCH /api/incidents/:id — role guard", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(buildApp())
      .patch("/api/incidents/inc-1")
      .send({ status: "resolved" });
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 403 for a 'support' role (not allowed for incident management)", async () => {
    const res = await request(buildApp())
      .patch("/api/incidents/inc-1")
      .set("Authorization", `Bearer ${tokenFor("support")}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 403 for a token with no role claim at all", async () => {
    const res = await request(buildApp())
      .patch("/api/incidents/inc-1")
      .set("Authorization", `Bearer ${tokenFor(undefined)}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 403 for an unknown role string", async () => {
    const res = await request(buildApp())
      .patch("/api/incidents/inc-1")
      .set("Authorization", `Bearer ${tokenFor("intern")}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows 'admin'", async () => {
    const res = await request(buildApp())
      .patch("/api/incidents/inc-1")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("allows 'operations'", async () => {
    const res = await request(buildApp())
      .patch("/api/incidents/inc-1")
      .set("Authorization", `Bearer ${tokenFor("operations")}`)
      .send({ status: "confirmed" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("allows 'engineering'", async () => {
    const res = await request(buildApp())
      .patch("/api/incidents/inc-1")
      .set("Authorization", `Bearer ${tokenFor("engineering")}`)
      .send({ rootCause: "Bad deploy at 2:14 PM" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
