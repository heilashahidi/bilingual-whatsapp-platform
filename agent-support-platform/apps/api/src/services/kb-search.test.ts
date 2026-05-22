import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ClassificationResult } from "@asp/shared";

// Mock Prisma — kb-search talks to two tables and one transaction. We
// only need to verify it calls upsert with the *right* article ids.
vi.mock("./database", () => ({
  prisma: {
    knowledgeArticle: { findMany: vi.fn() },
    ticketSuggestedResolution: { upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

import { findSuggestedResolutions } from "./kb-search";
import { prisma } from "./database";

const findMany = prisma.knowledgeArticle.findMany as ReturnType<typeof vi.fn>;
const upsert = prisma.ticketSuggestedResolution.upsert as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;

function makeClassification(
  overrides: Partial<ClassificationResult> = {}
): ClassificationResult {
  return {
    category: "bug_report",
    severity: "medium",
    tags: ["login", "network"],
    productArea: "auth",
    confidence: 0.9,
    likelyNetwork: false,
    ...overrides,
  } as ClassificationResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockImplementation((args) => args);
  transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe("findSuggestedResolutions", () => {
  it("is a no-op when no classification is provided", async () => {
    await findSuggestedResolutions("ticket-1", null);
    expect(findMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("queries only active articles, never drafts or archived", async () => {
    findMany.mockResolvedValue([]);
    await findSuggestedResolutions("ticket-1", makeClassification());

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0];
    expect(args.where.status).toBe("active");
  });

  it("returns early without writing when no articles match", async () => {
    findMany.mockResolvedValue([]);
    await findSuggestedResolutions("ticket-1", makeClassification());
    expect(transaction).not.toHaveBeenCalled();
  });

  it("ranks an article matching category + productArea + tags above a weaker match", async () => {
    findMany.mockResolvedValue([
      // Cat + one tag → passes threshold but ranks below strong
      { id: "weak", category: "bug_report", productArea: null, tags: ["login"] },
      {
        id: "strong",
        category: "bug_report",
        productArea: "auth",
        tags: ["login", "network"],
      },
    ]);

    await findSuggestedResolutions("ticket-1", makeClassification());

    // Both pass the 0.34 threshold; strong should appear first.
    expect(transaction).toHaveBeenCalledTimes(1);
    const ops = transaction.mock.calls[0][0] as Array<{
      where: { ticketId_articleId: { articleId: string } };
    }>;
    expect(ops[0].where.ticketId_articleId.articleId).toBe("strong");
    expect(ops[1].where.ticketId_articleId.articleId).toBe("weak");
  });

  it("drops articles below the 0.34 score floor", async () => {
    // Only one weak tag overlap (1/3 ≈ 0.33 raw → 0.33/3 ≈ 0.11 normalized)
    // — below the 0.34 threshold so it must be dropped.
    findMany.mockResolvedValue([
      {
        id: "marginal",
        category: "question",
        productArea: null,
        tags: ["network"],
      },
    ]);

    await findSuggestedResolutions("ticket-1", makeClassification());
    expect(transaction).not.toHaveBeenCalled();
  });

  it("caps suggestions at 3 even when more articles match", async () => {
    // Five articles that all match category exactly — all score 0.33,
    // but only 3 should reach the upsert step.
    findMany.mockResolvedValue([
      { id: "a1", category: "bug_report", productArea: "auth", tags: ["login"] },
      { id: "a2", category: "bug_report", productArea: "auth", tags: ["login"] },
      { id: "a3", category: "bug_report", productArea: "auth", tags: ["login"] },
      { id: "a4", category: "bug_report", productArea: "auth", tags: ["login"] },
      { id: "a5", category: "bug_report", productArea: "auth", tags: ["login"] },
    ]);

    await findSuggestedResolutions("ticket-1", makeClassification());

    expect(transaction).toHaveBeenCalledTimes(1);
    const ops = transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(3);
  });

  it("uses the ticketId+articleId composite key for idempotent upserts", async () => {
    findMany.mockResolvedValue([
      {
        id: "strong",
        category: "bug_report",
        productArea: "auth",
        tags: ["login", "network"],
      },
    ]);

    await findSuggestedResolutions("ticket-42", makeClassification());

    const ops = transaction.mock.calls[0][0] as Array<{
      where: { ticketId_articleId: { ticketId: string; articleId: string } };
    }>;
    expect(ops[0].where.ticketId_articleId).toEqual({
      ticketId: "ticket-42",
      articleId: "strong",
    });
  });
});
