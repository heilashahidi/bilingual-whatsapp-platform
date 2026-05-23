import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { draftKbArticle } from "./kb-drafter";

const fetchMock = vi.fn();
const originalFetch = global.fetch;

function baseCtx() {
  return {
    category: "bug_report",
    productArea: "auth",
    classifierTags: ["login", "network"],
    conversation: [
      { who: "agent" as const, text: "I can't log in" },
      { who: "operator" as const, text: "Try clearing the app cache." },
      { who: "agent" as const, text: "That fixed it, thanks." },
    ],
    resolutionSummary: "Clearing app cache from settings resolved the login loop.",
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

describe("draftKbArticle", () => {
  it("returns null when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await draftKbArticle(baseCtx());
    expect(result).toBeNull();
  });

  it("parses a well-formed Claude response into a KbDraft", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              title: "Login loop after recent update",
              problemDescription:
                "User sees the spinner indefinitely after submitting credentials.",
              resolutionText:
                "1. Open Settings.\n2. Tap Clear Cache.\n3. Retry login.",
              resolutionTextShort: "Clear cache from Settings, then retry.",
              tags: ["login", "cache", "android"],
            }),
          },
        ],
      }),
    });

    const result = await draftKbArticle(baseCtx());
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Login loop after recent update");
    expect(result!.tags).toEqual(["login", "cache", "android"]);
    expect(result!.resolutionTextShort.length).toBeLessThanOrEqual(480);
  });

  it("derives the short variant when Claude omits resolutionTextShort", async () => {
    const longResolution = "1. " + "step ".repeat(120);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              title: "x",
              problemDescription: "y",
              resolutionText: longResolution,
              tags: ["t"],
            }),
          },
        ],
      }),
    });

    const result = await draftKbArticle(baseCtx());
    expect(result).not.toBeNull();
    // We truncate over-long resolutions to 480 chars.
    expect(result!.resolutionTextShort.length).toBeLessThanOrEqual(480);
    expect(result!.resolutionTextShort.endsWith("…")).toBe(true);
  });

  it("returns null on a non-OK Claude response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const result = await draftKbArticle(baseCtx());
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "this is not json" }] }),
    });
    const result = await draftKbArticle(baseCtx());
    expect(result).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({ title: "ok", resolutionText: "ok" }), // missing problemDescription
          },
        ],
      }),
    });
    const result = await draftKbArticle(baseCtx());
    expect(result).toBeNull();
  });

  it("normalizes tags: lowercase, trim, filter empties, cap at 8", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              title: "t",
              problemDescription: "p",
              resolutionText: "r",
              tags: [
                "Login",
                "  CACHE  ",
                "",
                "android",
                "ios",
                "iPhone",
                "POS",
                "branchpay",
                "transactions",
                "extra-9",
                "extra-10",
              ],
            }),
          },
        ],
      }),
    });

    const result = await draftKbArticle(baseCtx());
    expect(result).not.toBeNull();
    expect(result!.tags).toEqual([
      "login",
      "cache",
      "android",
      "ios",
      "iphone",
      "pos",
      "branchpay",
      "transactions",
    ]);
  });

  it("includes the conversation + resolution summary in the prompt", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              title: "t",
              problemDescription: "p",
              resolutionText: "r",
              tags: [],
            }),
          },
        ],
      }),
    });

    await draftKbArticle(baseCtx());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("I can't log in");
    expect(prompt).toContain("Try clearing the app cache.");
    expect(prompt).toContain("Clearing app cache from settings resolved the login loop.");
  });
});
