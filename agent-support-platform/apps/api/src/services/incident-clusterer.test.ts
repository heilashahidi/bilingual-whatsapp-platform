import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the modules the clusterer touches BEFORE importing it. Vitest hoists
// vi.mock calls above imports, so the clusterer picks up the mock copies.
vi.mock("./database", () => ({
  prisma: {
    ticket: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    incident: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    event: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("./audit", () => ({ recordEvent: vi.fn() }));
vi.mock("./realtime", () => ({ emitTicketEvent: vi.fn() }));

import { clusterTicket } from "./incident-clusterer";
import { prisma } from "./database";

// Cast helpers so the mocked methods accept .mockResolvedValue.
const mocked = {
  ticketFindUnique: prisma.ticket.findUnique as ReturnType<typeof vi.fn>,
  ticketFindMany: prisma.ticket.findMany as ReturnType<typeof vi.fn>,
  ticketUpdate: prisma.ticket.update as ReturnType<typeof vi.fn>,
  incidentFindFirst: prisma.incident.findFirst as ReturnType<typeof vi.fn>,
  incidentCreate: prisma.incident.create as ReturnType<typeof vi.fn>,
  incidentUpdate: prisma.incident.update as ReturnType<typeof vi.fn>,
};

function makeTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id ?? "ticket-1",
    incidentId: null,
    deletedAt: null,
    category: "bug_report",
    severity: "high",
    tags: [],
    createdAt: new Date(),
    agent: {
      country: "HT",
      branchId: "branch-A",
      branch: { id: "branch-A", country: "HT" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("clusterTicket", () => {
  it("returns null and does not create an incident when fewer than 3 recent tickets exist", async () => {
    mocked.ticketFindUnique.mockResolvedValue(makeTicket());
    mocked.incidentFindFirst.mockResolvedValue(null);
    mocked.ticketFindMany.mockResolvedValue([makeTicket({ id: "a" }), makeTicket({ id: "b" })]);

    const result = await clusterTicket("ticket-1");

    expect(result).toBeNull();
    expect(mocked.incidentCreate).not.toHaveBeenCalled();
  });

  it("creates an incident and attaches all contributing tickets when threshold is met", async () => {
    const candidates = [
      makeTicket({ id: "a" }),
      makeTicket({ id: "b", severity: "critical" }),
      makeTicket({ id: "c", agent: { country: "HT", branchId: "branch-B" } }),
    ];
    mocked.ticketFindUnique.mockResolvedValue(candidates[0]);
    mocked.incidentFindFirst.mockResolvedValue(null);
    mocked.ticketFindMany.mockResolvedValue(candidates);
    mocked.incidentCreate.mockResolvedValue({
      id: "inc-1",
      title: "Bug Report surge — Haiti",
      severity: "critical",
      affectedCountries: ["HT"],
      affectedBranches: ["branch-A", "branch-B"],
    });

    const result = await clusterTicket("ticket-1");

    expect(result).toBe("inc-1");
    expect(mocked.incidentCreate).toHaveBeenCalledTimes(1);

    // Incident takes the *max* severity of contributing tickets.
    const createArgs = mocked.incidentCreate.mock.calls[0][0];
    expect(createArgs.data.severity).toBe("critical");
    // Branches deduped from the candidate set.
    expect(createArgs.data.affectedBranches).toEqual(
      expect.arrayContaining(["branch-A", "branch-B"])
    );
    // Country populated from the agent's country.
    expect(createArgs.data.affectedCountries).toEqual(["HT"]);

    // Every candidate gets the incidentId stamped on it.
    expect(mocked.ticketUpdate).toHaveBeenCalledTimes(candidates.length);
  });

  it("attaches a new ticket to an existing open incident instead of forming a new one", async () => {
    const newTicket = makeTicket({ id: "fresh", severity: "medium" });
    const existing = {
      id: "inc-existing",
      status: "detected",
      severity: "high",
      category: "bug_report",
      affectedCountries: ["HT"],
      affectedBranches: ["branch-A"],
    };
    mocked.ticketFindUnique.mockResolvedValue(newTicket);
    mocked.incidentFindFirst.mockResolvedValue(existing);

    const result = await clusterTicket("fresh");

    expect(result).toBe("inc-existing");
    expect(mocked.incidentCreate).not.toHaveBeenCalled();
    // The new ticket got linked to the existing incident.
    expect(mocked.ticketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fresh" },
        data: { incidentId: "inc-existing" },
      })
    );
  });

  it("bumps existing incident severity when a more severe ticket joins", async () => {
    const newTicket = makeTicket({ id: "fresh", severity: "critical" });
    const existing = {
      id: "inc-existing",
      status: "detected",
      severity: "medium",
      category: "bug_report",
      affectedCountries: ["HT"],
      affectedBranches: ["branch-A"],
    };
    mocked.ticketFindUnique.mockResolvedValue(newTicket);
    mocked.incidentFindFirst.mockResolvedValue(existing);

    await clusterTicket("fresh");

    expect(mocked.incidentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inc-existing" },
        data: expect.objectContaining({ severity: "critical" }),
      })
    );
  });

  it("returns the ticket's incidentId unchanged if it's already clustered", async () => {
    mocked.ticketFindUnique.mockResolvedValue(
      makeTicket({ id: "ticket-1", incidentId: "inc-prior" })
    );

    const result = await clusterTicket("ticket-1");

    expect(result).toBe("inc-prior");
    expect(mocked.incidentFindFirst).not.toHaveBeenCalled();
    expect(mocked.incidentCreate).not.toHaveBeenCalled();
  });

  it("does not cluster a deleted ticket", async () => {
    mocked.ticketFindUnique.mockResolvedValue(
      makeTicket({ deletedAt: new Date() })
    );

    const result = await clusterTicket("ticket-1");

    expect(result).toBeNull();
    expect(mocked.incidentFindFirst).not.toHaveBeenCalled();
  });
});
