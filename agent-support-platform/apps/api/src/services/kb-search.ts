import { prisma } from "./database";
import type { ClassificationResult } from "@asp/shared";

// Finds the most relevant active KnowledgeArticles for a freshly-classified
// ticket and pins them as suggestedResolutions. The team sees them in the
// detail page sidebar.
//
// Scoring is intentionally simple for now: category match + tag overlap +
// product area match. When we later wire vector embeddings, this function
// will rank by embedding similarity instead. The TicketSuggestedResolution
// table already records a numeric similarityScore.

const MAX_SUGGESTIONS = 3;

export async function findSuggestedResolutions(
  ticketId: string,
  classification: ClassificationResult | null
): Promise<void> {
  if (!classification) return;

  // Only consider active articles; drafts haven't been approved yet.
  const articles = await prisma.knowledgeArticle.findMany({
    where: {
      status: "active",
      OR: [
        { category: classification.category as never },
        { productArea: classification.productArea },
        { tags: { hasSome: classification.tags } },
      ],
    },
    select: {
      id: true,
      category: true,
      productArea: true,
      tags: true,
    },
  });

  if (articles.length === 0) return;

  // Score each article. Max possible = 1 (category) + 1 (productArea) + 1 (tag overlap).
  const scored = articles
    .map((a) => {
      let score = 0;
      if (a.category === classification.category) score += 1;
      if (a.productArea && a.productArea === classification.productArea)
        score += 1;
      const tagOverlap = a.tags.filter((t) =>
        classification.tags.includes(t)
      ).length;
      if (tagOverlap > 0) score += Math.min(1, tagOverlap / 3);
      return { id: a.id, score: score / 3 }; // normalize to 0–1
    })
    .filter((a) => a.score >= 0.34) // at least one strong signal
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  if (scored.length === 0) return;

  // Insert TicketSuggestedResolution rows. The schema's @@unique on
  // (ticketId, articleId) keeps us idempotent if this fires twice.
  await prisma.$transaction(
    scored.map((s) =>
      prisma.ticketSuggestedResolution.upsert({
        where: { ticketId_articleId: { ticketId, articleId: s.id } },
        create: { ticketId, articleId: s.id, similarityScore: s.score },
        update: { similarityScore: s.score },
      })
    )
  );

  console.log(
    `  📚 KB: pinned ${scored.length} suggestion(s) to ticket ${ticketId.slice(0, 8)}`
  );
}
