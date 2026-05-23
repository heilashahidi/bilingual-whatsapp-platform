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
    ticket: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: { create: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("../services/realtime", () => ({ emitTicketEvent: vi.fn() }));
vi.mock("../services/kb-indexer", () => ({ indexResolvedTicket: vi.fn() }));
vi.mock("../services/audit", () => ({ recordEvent: vi.fn() }));
vi.mock("../services/notifier", () => ({ notifyMention: vi.fn() }));
vi.mock("../services/reply-suggester", () => ({ suggestReplies: vi.fn() }));
vi.mock("../integrations/whatsapp", () => ({
  sendAgentResponse: vi.fn().mockResolvedValue({
    messageSid: "SM_test",
    translatedText: "translated",
  }),
}));

// Skip the auth middleware so we can hit routes without minting a JWT.
process.env.DISABLE_AUTH = "true";

import { ticketRouter } from "./tickets";
import { prisma } from "../services/database";

const findMany = prisma.ticket.findMany as ReturnType<typeof vi.fn>;
const count = prisma.ticket.count as ReturnType<typeof vi.fn>;
const ticketFindUnique = prisma.ticket.findUnique as ReturnType<typeof vi.fn>;
const ticketUpdate = prisma.ticket.update as ReturnType<typeof vi.fn>;
const messageCreate = prisma.message.create as ReturnType<typeof vi.fn>;
const messageFindFirst = prisma.message.findFirst as ReturnType<typeof vi.fn>;

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

describe("GET /api/tickets — pagination validation", () => {
  beforeEach(() => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
  });

  it("rejects non-numeric limit with 400", async () => {
    const res = await request(buildApp()).get("/api/tickets?limit=foo");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/i);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects negative limit with 400", async () => {
    const res = await request(buildApp()).get("/api/tickets?limit=-5");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 200/);
  });

  it("rejects limit above the max (200) with 400", async () => {
    const res = await request(buildApp()).get("/api/tickets?limit=500");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 200/);
  });

  it("rejects fractional limit with 400", async () => {
    const res = await request(buildApp()).get("/api/tickets?limit=10.5");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/integer/);
  });

  it("rejects negative offset with 400", async () => {
    const res = await request(buildApp()).get("/api/tickets?offset=-1");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/>= 0/);
  });

  it("rejects non-numeric offset with 400", async () => {
    const res = await request(buildApp()).get("/api/tickets?offset=NaN");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/offset/i);
  });

  it("accepts limit=1 (lower bound)", async () => {
    const res = await request(buildApp()).get("/api/tickets?limit=1");
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it("accepts limit=200 (upper bound)", async () => {
    const res = await request(buildApp()).get("/api/tickets?limit=200");
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].take).toBe(200);
  });

  it("accepts offset=0 (lower bound)", async () => {
    const res = await request(buildApp()).get("/api/tickets?offset=0");
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it("defaults to limit=50 offset=0 when params are absent", async () => {
    const res = await request(buildApp()).get("/api/tickets");
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].take).toBe(50);
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });
});

describe("POST /api/tickets/:id/messages — sender identity", () => {
  // The auth middleware is bypassed in tests (DISABLE_AUTH=true), so
  // req.user is undefined. The route must therefore:
  //   - never read senderId from the body
  //   - persist senderId=null when no authenticated user is present
  //     under DISABLE_AUTH (test/dev mode)
  // In any environment where auth is enforced, a missing user yields 401.

  beforeEach(() => {
    ticketFindUnique.mockResolvedValue({
      id: "ticket-1",
      slaFirstResponseMet: null,
      agent: {
        phoneNumber: "+50937001001",
        country: "HT",
        preferredLanguage: "ht",
      },
    });
    messageFindFirst.mockResolvedValue({ originalLanguage: "en" });
    messageCreate.mockResolvedValue({
      id: "msg-1",
      direction: "outbound",
      senderType: "internal_user",
      senderId: null,
      originalText: "hello",
    });
    ticketUpdate.mockResolvedValue({});
  });

  it("ignores any senderId in the request body — uses req.user only", async () => {
    const res = await request(buildApp())
      .post("/api/tickets/ticket-1/messages")
      .send({ text: "hello", senderId: "attacker-impersonating-someone-else" });

    expect(res.status).toBe(200);
    expect(messageCreate).toHaveBeenCalledTimes(1);
    const writeArgs = messageCreate.mock.calls[0][0];
    // Under DISABLE_AUTH, req.user is undefined → senderId becomes null,
    // NEVER "attacker-impersonating-someone-else" from the body.
    expect(writeArgs.data.senderId).toBeNull();
    expect(writeArgs.data.senderId).not.toBe(
      "attacker-impersonating-someone-else"
    );
  });

  it("returns 400 when text is missing", async () => {
    const res = await request(buildApp())
      .post("/api/tickets/ticket-1/messages")
      .send({ senderId: "anything" });

    expect(res.status).toBe(400);
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when auth is enforced but no user is on the request", async () => {
    // Temporarily flip auth on. The mocked router still has no real auth
    // middleware applied (the test mounts `ticketRouter` directly without
    // requireAuth), so req.user stays undefined and the handler's own
    // guard returns 401.
    const prev = process.env.DISABLE_AUTH;
    delete process.env.DISABLE_AUTH;
    try {
      const res = await request(buildApp())
        .post("/api/tickets/ticket-1/messages")
        .send({ text: "hello", senderId: "spoofed" });

      expect(res.status).toBe(401);
      expect(messageCreate).not.toHaveBeenCalled();
    } finally {
      process.env.DISABLE_AUTH = prev;
    }
  });
});
