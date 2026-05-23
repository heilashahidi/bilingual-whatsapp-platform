import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("./database", () => ({
  prisma: {
    ticket: { findUnique: vi.fn() },
  },
}));

import { suggestReplies } from "./reply-suggester";
import { prisma } from "./database";

const findUnique = prisma.ticket.findUnique as ReturnType<typeof vi.fn>;

// Stubbed global fetch — we never want to hit the real Anthropic API
// from a unit test.
const fetchMock = vi.fn();
const originalFetch = global.fetch;

function buildTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ticket-1",
    category: "bug_report",
    severity: "high",
    tags: ["login", "network"],
    agent: {
      name: "Jean-Baptiste Pierre",
      country: "HT",
      branch: { name: "Cap-Haïtien Central" },
    },
    messages: [
      {
        direction: "inbound",
        originalText: "Mwen pa ka konekte",
        translatedText: "I can't log in",
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
    ],
    suggestedResolutions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("suggestReplies", () => {
  it("returns empty array when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await suggestReplies("ticket-1");
    expect(result).toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns empty array when the ticket doesn't exist", async () => {
    findUnique.mockResolvedValue(null);
    const result = await suggestReplies("missing");
    expect(result).toEqual([]);
  });

  it("returns empty array when there's no inbound message to reply to", async () => {
    findUnique.mockResolvedValue(
      buildTicket({
        // ticket exists but only outbound messages — nothing to reply to
        messages: [
          {
            direction: "outbound",
            originalText: "We're looking into it",
            translatedText: "We're looking into it",
            createdAt: new Date(),
          },
        ],
      })
    );
    const result = await suggestReplies("ticket-1");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses three suggestions back from Claude's JSON response", async () => {
    findUnique.mockResolvedValue(buildTicket());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              suggestions: [
                { tone: "direct", text: "Please clear your app cache and try again." },
                {
                  tone: "empathetic",
                  text: "Sorry you're stuck — let's get you back in. Try restarting the app first.",
                },
                {
                  tone: "investigative",
                  text: "Can you tell me what happens after you tap 'Login'? Any error?",
                },
              ],
            }),
          },
        ],
      }),
    });

    const result = await suggestReplies("ticket-1");
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.tone)).toEqual([
      "direct",
      "empathetic",
      "investigative",
    ]);
  });

  it("includes the conversation in the prompt sent to Claude", async () => {
    findUnique.mockResolvedValue(buildTicket());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify({ suggestions: [] }) }],
      }),
    });

    await suggestReplies("ticket-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const prompt = body.messages[0].content as string;
    // The translated text of the inbound message should appear in the prompt.
    expect(prompt).toContain("I can't log in");
    // The agent's name and branch should be in the context block.
    expect(prompt).toContain("Jean-Baptiste Pierre");
    expect(prompt).toContain("Cap-Haïtien Central");
  });

  it("strips markdown code fences before parsing", async () => {
    findUnique.mockResolvedValue(buildTicket());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text:
              "```json\n" +
              JSON.stringify({
                suggestions: [
                  { tone: "direct", text: "Try this." },
                ],
              }) +
              "\n```",
          },
        ],
      }),
    });

    const result = await suggestReplies("ticket-1");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Try this.");
  });

  it("caps suggestions at 3 even if Claude returns more", async () => {
    findUnique.mockResolvedValue(buildTicket());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              suggestions: [
                { tone: "a", text: "1" },
                { tone: "b", text: "2" },
                { tone: "c", text: "3" },
                { tone: "d", text: "4" },
                { tone: "e", text: "5" },
              ],
            }),
          },
        ],
      }),
    });

    const result = await suggestReplies("ticket-1");
    expect(result).toHaveLength(3);
  });

  it("returns empty array on a non-OK response from Claude", async () => {
    findUnique.mockResolvedValue(buildTicket());
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const result = await suggestReplies("ticket-1");
    expect(result).toEqual([]);
  });

  it("returns empty array on malformed JSON from Claude", async () => {
    findUnique.mockResolvedValue(buildTicket());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "definitely not json" }] }),
    });
    const result = await suggestReplies("ticket-1");
    expect(result).toEqual([]);
  });

  it("filters out malformed suggestions missing required fields", async () => {
    findUnique.mockResolvedValue(buildTicket());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              suggestions: [
                { tone: "direct", text: "ok" },
                { tone: 123, text: "bad tone type" },
                { text: "missing tone" },
                null,
              ],
            }),
          },
        ],
      }),
    });

    const result = await suggestReplies("ticket-1");
    expect(result).toHaveLength(1);
    expect(result[0].tone).toBe("direct");
  });
});
