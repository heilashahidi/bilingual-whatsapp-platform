import { prisma } from "./database";
import { draftKbArticle } from "./kb-drafter";

// Generates a draft KnowledgeArticle from a resolved ticket. Triggered
// from the resolve route once a resolution summary has been written.
//
// Two-stage strategy:
//   1. Ask Claude Haiku (via kb-drafter) for a polished article.
//   2. If Claude is unavailable or returns null, fall back to the
//      mechanical "first inbound as problem + concatenated outbound
//      responses as resolution" approach. KB drafts always get created
//      regardless of LLM availability — the operator approves the draft
//      on /knowledge before it becomes searchable.
export async function indexResolvedTicket(ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticket) return;
  if (!ticket.resolutionSummary || !ticket.resolutionSummary.trim()) {
    // No summary means we can't build a useful article. Indexer is opt-in
    // on the close flow — the resolve modal nudges for one.
    return;
  }

  // Feature requests don't belong in a knowledge base of "how to fix things"
  if (ticket.category === "feature_request") return;

  // Don't double-create. If we've already indexed this ticket, skip.
  const existing = await prisma.knowledgeArticle.findFirst({
    where: { sourceTicketIds: { has: ticket.id } },
  });
  if (existing) return;

  // ─── Stage 1: try Claude ────────────────────────────────────────
  const conversation = ticket.messages
    .map((m) => ({
      who:
        m.direction === "inbound"
          ? ("agent" as const)
          : ("operator" as const),
      text:
        (m.direction === "inbound" ? m.translatedText : m.originalText) ||
        m.originalText ||
        m.translatedText ||
        "",
    }))
    .filter((m) => m.text.trim().length > 0);

  const drafted = await draftKbArticle({
    category: ticket.category,
    productArea: ticket.productArea,
    classifierTags: ticket.tags ?? [],
    conversation,
    resolutionSummary: ticket.resolutionSummary,
  });

  if (drafted) {
    await prisma.knowledgeArticle.create({
      data: {
        title: drafted.title,
        problemDescription: drafted.problemDescription,
        resolutionText: drafted.resolutionText,
        resolutionTextShort: drafted.resolutionTextShort,
        category: ticket.category,
        productArea: ticket.productArea,
        // Union of the classifier's tags + Claude's tags, deduped.
        tags: Array.from(new Set([...(ticket.tags ?? []), ...drafted.tags])),
        sourceTicketIds: [ticket.id],
        status: "draft",
      },
    });
    console.log(
      `  📚 KB: Claude-drafted "${drafted.title.slice(0, 60)}" from ticket ${ticket.id.slice(0, 8)}`
    );
    return;
  }

  // ─── Stage 2: mechanical fallback ───────────────────────────────
  // Use the first inbound message as the problem description (it's the
  // agent's own words about the issue, already translated into English).
  const firstInbound = ticket.messages.find((m) => m.direction === "inbound");
  const problemDescription =
    firstInbound?.translatedText ||
    firstInbound?.originalText ||
    `${ticket.category} ticket`;

  // Combine the human-written resolution summary with any team-sent
  // outbound messages so the article captures what was actually told
  // to the agent. The summary leads (it's the curated version).
  const teamResponses = ticket.messages
    .filter((m) => m.direction === "outbound" && m.senderType === "internal_user")
    .map((m) => m.originalText)
    .filter((t): t is string => !!t && t.trim().length > 0);

  const resolutionText = teamResponses.length
    ? `${ticket.resolutionSummary.trim()}\n\nResponses sent to the agent:\n${teamResponses
        .map((r) => `- ${r}`)
        .join("\n")}`
    : ticket.resolutionSummary.trim();

  // Short variant for bot delivery on low-bandwidth connections.
  const resolutionTextShort =
    resolutionText.length > 480
      ? resolutionText.slice(0, 477) + "…"
      : resolutionText;

  const title = makeTitle(problemDescription);

  await prisma.knowledgeArticle.create({
    data: {
      title,
      problemDescription,
      resolutionText,
      resolutionTextShort,
      category: ticket.category,
      productArea: ticket.productArea,
      tags: ticket.tags,
      sourceTicketIds: [ticket.id],
      status: "draft",
    },
  });

  console.log(
    `  📚 KB: mechanically drafted "${title.slice(0, 60)}" from ticket ${ticket.id.slice(0, 8)} (Claude unavailable)`
  );
}

function makeTitle(problem: string): string {
  // Trim to roughly the first sentence or 80 chars, whichever's shorter.
  const cleaned = problem.replace(/\s+/g, " ").trim();
  const firstSentence = cleaned.split(/[.!?]\s/)[0];
  const candidate = firstSentence.length < 80 ? firstSentence : cleaned.slice(0, 77);
  return candidate.length === cleaned.length ? candidate : `${candidate}…`;
}
