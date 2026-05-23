import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./database", () => ({
  prisma: {
    incident: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { summarizeIncident } from "./incident-summarizer";
import { prisma } from "./database";

const findUnique = prisma.incident.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.incident.update as ReturnType<typeof vi.fn>;

const fetchMock = vi.fn();
const originalFetch = global.fetch;

function buildIncident(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inc-1",
    title: "Bug Report surge — Haiti",
    category: "bug_report",
    severity: "high",
    tickets: [
      {
        id: "t1",
        category: "bug_report",
        severity: "high",
        tags: ["login"],
        agent: {
          country: "HT",
          branch: { name: "Cap-Haïtien Central", region: "Nord" },
        },
        messages: [{ translatedText: "I can't log in", originalText: "" }],
      },
      {
        id: "t2",
        category: "bug_report",
        severity: "high",
        tags: ["login"],
        agent: {
          country: "HT",
          branch: { name: "Port-au-Prince Hub", region: "Ouest" },
        },
        messages: [{ translatedText: "Login screen frozen", originalText: "" }],
      },
      {
        id: "t3",
        category: "bug_report",
        severity: "critical",
        tags: ["login", "network"],
        agent: {
          country: "HT",
          branch: { name: "Jacmel Branch", region: "Sud-Est" },
        },
        messages: [{ translatedText: "App won't open", originalText: "" }],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
  global.fetch = fetchMock as unknown as typeof fetch;
  update.mockResolvedValue({});
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("summarizeIncident", () => {
  it("no-ops when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await summarizeIncident("inc-1");
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("no-ops when the incident doesn't exist", async () => {
    findUnique.mockResolvedValue(null);
    await summarizeIncident("missing");
    expect(update).not.toHaveBeenCalled();
  });

  it("no-ops when the incident has no contributing tickets", async () => {
    findUnique.mockResolvedValue(buildIncident({ tickets: [] }));
    await summarizeIncident("inc-1");
    expect(update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates the incident title and rootCause from Claude's response", async () => {
    findUnique.mockResolvedValue(buildIncident());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              title: "Login screen frozen across HT branches",
              rootCause:
                "Likely an Android app crash on the latest update. Check the recent app store release notes and verify with one branch.",
            }),
          },
        ],
      }),
    });

    await summarizeIncident("inc-1");

    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "inc-1" });
    expect(args.data.title).toBe("Login screen frozen across HT branches");
    expect(args.data.rootCause).toContain("Android app crash");
  });

  it("sends each contributing ticket's first message into the prompt", async () => {
    findUnique.mockResolvedValue(buildIncident());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              title: "x",
              rootCause: "y",
            }),
          },
        ],
      }),
    });

    await summarizeIncident("inc-1");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("I can't log in");
    expect(prompt).toContain("Login screen frozen");
    expect(prompt).toContain("App won't open");
    // Branch names should be in the per-ticket lines too.
    expect(prompt).toContain("Cap-Haïtien Central");
    expect(prompt).toContain("Port-au-Prince Hub");
  });

  it("does NOT update the incident on a non-OK Claude response", async () => {
    findUnique.mockResolvedValue(buildIncident());
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await summarizeIncident("inc-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("does NOT update the incident on malformed JSON output", async () => {
    findUnique.mockResolvedValue(buildIncident());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "not-json" }] }),
    });
    await summarizeIncident("inc-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects updates where required fields are missing", async () => {
    findUnique.mockResolvedValue(buildIncident());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({ title: "ok", rootCause: "" }), // empty rootCause → rejected
          },
        ],
      }),
    });
    await summarizeIncident("inc-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("caps an over-long title at 120 chars", async () => {
    findUnique.mockResolvedValue(buildIncident());
    const longTitle = "a".repeat(300);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({ title: longTitle, rootCause: "ok" }),
          },
        ],
      }),
    });
    await summarizeIncident("inc-1");
    const args = update.mock.calls[0][0];
    expect(args.data.title.length).toBe(120);
  });
});
