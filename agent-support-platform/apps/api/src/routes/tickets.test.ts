import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// HTTP-level integration tests for the tickets router. Prisma is fully
// mocked — these tests cover the wire-shape contract the dashboard
// depends on (200 status, JSON shape, query-param → where clause).
//
// Why not test against a real DB? It would force vitest to wait on a
// docker compose up + migrate cycle, which is too slow for the unit
// test loop and not what these particular tests need to verify.

vi.mock("../services/database", () => ({
  prisma: {
    ticket: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("../services/realtime", () => ({ emitTicketEvent: vi.fn() }));
vi.mock("../services/kb-indexer", () => ({ indexResolvedTicket: vi.fn() }));
vi.mock("../services/audit", () => ({ recordEvent: vi.fn() }));
vi.mock("../services/notifier", () => ({ notifyMention: vi.fn() }));
vi.mock("../integrations/whatsapp", () => ({ sendAgentResponse: vi.fn() }));

// Skip the auth middleware so we can hit routes without minting a JWT.
process.env.DISABLE_AUTH = "true";

import { ticketRouter } from "./tickets";
import { prisma } from "../services/database";

const findMany = prisma.ticket.findMany as ReturnType<typeof vi.fn>;
const count = prisma.ticket.count as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", ticketRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tickets", () => {
  it("returns a 200 with { tickets, total } shape", async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    const res = await request(buildApp()).get("/api/tickets");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tickets: [], total: 0 });
  });

  it("flattens incident._count.tickets into incident.ticketCount", async () => {
    findMany.mockResolvedValue([
      {
        id: "ticket-1",
        incident: {
          id: "inc-1",
          title: "Login surge — Haiti",
          status: "detected",
          severity: "high",
          _count: { tickets: 7 },
        },
      },
    ]);
    count.mockResolvedValue(1);

    const res = await request(buildApp()).get("/api/tickets");

    expect(res.status).toBe(200);
    expect(res.body.tickets[0].incident.ticketCount).toBe(7);
    // _count should not leak through to the API consumer.
    expect(res.body.tickets[0].incident._count).toBeUndefined();
  });

  it("passes status/severity/country query params into the prisma where clause", async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await request(buildApp())
      .get("/api/tickets?status=open&severity=critical&country=HT");

    const args = findMany.mock.calls[0][0];
    expect(args.where.status).toBe("open");
    expect(args.where.severity).toBe("critical");
    expect(args.where.agent).toEqual({ country: "HT" });
    // Soft-deleted tickets stay excluded.
    expect(args.where.deletedAt).toBeNull();
  });

  it("respects limit + offset for pagination", async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await request(buildApp()).get("/api/tickets?limit=10&offset=20");

    const args = findMany.mock.calls[0][0];
    expect(args.take).toBe(10);
    expect(args.skip).toBe(20);
  });

  it("sorts by severity then SLA deadline so critical/urgent tickets surface first", async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await request(buildApp()).get("/api/tickets");

    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([
      { severity: "asc" },
      { slaFirstResponseDeadline: "asc" },
    ]);
  });

  it("leaves tickets without an incident untouched (no incident field added)", async () => {
    findMany.mockResolvedValue([
      { id: "ticket-1", incident: null },
    ]);
    count.mockResolvedValue(1);

    const res = await request(buildApp()).get("/api/tickets");

    expect(res.status).toBe(200);
    expect(res.body.tickets[0].incident).toBeNull();
  });
});
