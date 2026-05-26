import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// HTTP-level tests for the agents router with focus on the sender-
// verification controls added in SECURITY.md §5.1.

vi.mock("../services/database", () => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("../services/audit", () => ({ recordEvent: vi.fn() }));

process.env.DISABLE_AUTH = "true";

import { agentRouter } from "./agents";
import { prisma } from "../services/database";
import { recordEvent } from "../services/audit";

const findMany = prisma.agent.findMany as ReturnType<typeof vi.fn>;
const findUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.agent.update as ReturnType<typeof vi.fn>;
const recordEventMock = recordEvent as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agents — verification filter", () => {
  it("defaults to verified-only (excludes pending and rejected)", async () => {
    findMany.mockResolvedValue([]);

    await request(buildApp()).get("/api/agents").expect(200);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verifiedAt: { not: null },
          rejectedAt: null,
        }),
      })
    );
  });

  it("?verification=pending returns only unverified+not-rejected", async () => {
    findMany.mockResolvedValue([]);

    await request(buildApp())
      .get("/api/agents?verification=pending")
      .expect(200);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verifiedAt: null,
          rejectedAt: null,
        }),
      })
    );
  });

  it("?verification=rejected returns only rejected agents", async () => {
    findMany.mockResolvedValue([]);

    await request(buildApp())
      .get("/api/agents?verification=rejected")
      .expect(200);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rejectedAt: { not: null },
        }),
      })
    );
  });

  it("?verification=all returns everyone (no verification filter)", async () => {
    findMany.mockResolvedValue([]);

    await request(buildApp())
      .get("/api/agents?verification=all")
      .expect(200);

    const where = findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("verifiedAt");
    expect(where).not.toHaveProperty("rejectedAt");
  });

  it("unknown verification value falls back to verified-only", async () => {
    findMany.mockResolvedValue([]);

    await request(buildApp())
      .get("/api/agents?verification=bogus")
      .expect(200);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verifiedAt: { not: null },
          rejectedAt: null,
        }),
      })
    );
  });
});

describe("POST /api/agents/:id/verify", () => {
  it("returns 404 if the agent doesn't exist", async () => {
    findUnique.mockResolvedValue(null);
    await request(buildApp()).post("/api/agents/missing/verify").expect(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("sets verifiedAt, clears rejectedAt, and audit-logs each existing ticket", async () => {
    findUnique.mockResolvedValue({
      id: "agent-1",
      tickets: [{ id: "ticket-a" }, { id: "ticket-b" }],
    });
    update.mockResolvedValue({
      id: "agent-1",
      verifiedAt: new Date(),
      rejectedAt: null,
    });

    const res = await request(buildApp())
      .post("/api/agents/agent-1/verify")
      .expect(200);

    expect(update).toHaveBeenCalledWith({
      where: { id: "agent-1" },
      data: expect.objectContaining({
        verifiedAt: expect.any(Date),
        rejectedAt: null,
      }),
    });
    expect(recordEventMock).toHaveBeenCalledTimes(2);
    expect(recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-a",
        action: "agent_verified",
      })
    );
    expect(recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-b",
        action: "agent_verified",
      })
    );
    expect(res.body.agent.id).toBe("agent-1");
  });
});

describe("POST /api/agents/:id/reject", () => {
  it("returns 404 if the agent doesn't exist", async () => {
    findUnique.mockResolvedValue(null);
    await request(buildApp()).post("/api/agents/missing/reject").expect(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("sets rejectedAt, clears verifiedAt, and audit-logs each existing ticket", async () => {
    findUnique.mockResolvedValue({
      id: "agent-1",
      tickets: [{ id: "ticket-c" }],
    });
    update.mockResolvedValue({
      id: "agent-1",
      verifiedAt: null,
      rejectedAt: new Date(),
    });

    await request(buildApp())
      .post("/api/agents/agent-1/reject")
      .expect(200);

    expect(update).toHaveBeenCalledWith({
      where: { id: "agent-1" },
      data: expect.objectContaining({
        rejectedAt: expect.any(Date),
        verifiedAt: null,
      }),
    });
    expect(recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-c",
        action: "agent_rejected",
      })
    );
  });
});
