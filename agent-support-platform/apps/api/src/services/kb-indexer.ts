import { prisma } from "./database";

// Generates a draft KnowledgeArticle from a resolved ticket. Triggered
// from the resolve route once a resolution summary has been written.
//
// The current implementation derives the article fields directly from
// the ticket — it works without any external API. When we later wire
// in Claude Haiku to clean up the language, this function is the only
// place to upgrade.
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

  // Auto-generated title — succinct, derived from the problem. The team
  // can rename when reviewing the draft.
  const title = makeTitle(problemDescription);

  // Don't double-create. If we've already indexed this ticket, skip.
  const existing = await prisma.knowledgeArticle.findFirst({
    where: { sourceTicketIds: { has: ticket.id } },
  });
  if (existing) return;

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
    `  📚 KB: drafted article "${title.slice(0, 60)}" from ticket ${ticket.id.slice(0, 8)}`
  );
}

function makeTitle(problem: string): string {
  // Trim to roughly the first sentence or 80 chars, whichever's shorter.
  const cleaned = problem.replace(/\s+/g, " ").trim();
  const firstSentence = cleaned.split(/[.!?]\s/)[0];
  const candidate = firstSentence.length < 80 ? firstSentence : cleaned.slice(0, 77);
  return candidate.length === cleaned.length ? candidate : `${candidate}…`;
}
