import { prisma } from "./database";
import type { ReplySuggestion } from "@asp/shared";

export type { ReplySuggestion };

// Reply-suggester: given a ticket id, ask Claude Haiku for three candidate
// operator responses (in English — the outbound translation pipeline handles
// the language conversion when the operator hits send).
//
// The three suggestions are deliberately varied in tone so an operator can
// pick the one closest to the right register: a direct one, an empathetic
// one, and an investigative (clarifying-question) one. The exact labels
// are just hints — operators always edit before sending.
//
// Falls back gracefully when ANTHROPIC_API_KEY is unset or Claude errors:
// returns an empty array rather than throwing, so the composer just hides
// the suggestions UI without breaking anything else.

export interface ConversationMessageForPrompt {
  who: "agent" | "operator";
  text: string;
  age: string;
}

export interface ReplySuggesterContext {
  conversation: ConversationMessageForPrompt[];
  agentName: string;
  agentCountry: string;
  branchName: string;
  category: string;
  severity: string;
  tags: string[];
  kbHints: Array<{ title: string; resolution: string }>;
}

export async function suggestReplies(
  ticketId: string
): Promise<ReplySuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("  ⚠ No ANTHROPIC_API_KEY — reply suggester returning empty");
    return [];
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      agent: { include: { branch: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 8, // Most recent 8 messages, in newest-first order
      },
      suggestedResolutions: {
        include: { article: true },
        orderBy: { similarityScore: "desc" },
        take: 2,
      },
    },
  });

  if (!ticket) return [];

  // Need at least one inbound message to suggest a reply to.
  const inboundCount = ticket.messages.filter(
    (m) => m.direction === "inbound"
  ).length;
  if (inboundCount === 0) return [];

  return generateReplySuggestions({
    conversation: buildConversationForPrompt(ticket.messages),
    agentName: ticket.agent.name,
    agentCountry: ticket.agent.country,
    branchName: ticket.agent.branch.name,
    category: ticket.category,
    severity: ticket.severity,
    tags: ticket.tags,
    kbHints: ticket.suggestedResolutions.map((s) => ({
      title: s.article.title,
      resolution: s.article.resolutionText,
    })),
  });
}

// Pure LLM-calling path: takes already-assembled context, asks Claude for
// suggestions, parses. Exported so evals can target it directly without
// needing a populated database.
export async function generateReplySuggestions(
  context: ReplySuggesterContext
): Promise<ReplySuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const prompt = buildPrompt(context);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`  ✗ Claude reply-suggester API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
    };
    const text = data.content?.[0]?.text ?? "";
    return parseSuggestions(text);
  } catch (err) {
    console.error("  ✗ Claude reply-suggester failed:", err);
    return [];
  }
}

function buildConversationForPrompt(
  messages: Array<{
    direction: string;
    originalText: string | null;
    translatedText: string | null;
    createdAt: Date;
  }>
): ConversationMessageForPrompt[] {
  // Reverse to chronological order for the prompt
  const ordered = [...messages].reverse();
  const now = Date.now();
  return ordered.map((m) => ({
    who: m.direction === "inbound" ? "agent" : "operator",
    // For inbound, show the English translation. For outbound, originalText
    // is already English. Fall back if either is missing.
    text:
      (m.direction === "inbound" ? m.translatedText : m.originalText) ||
      m.originalText ||
      m.translatedText ||
      "",
    age: humanAge(now - m.createdAt.getTime()),
  }));
}

function humanAge(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function buildPrompt(input: ReplySuggesterContext): string {
  const convoBlock = input.conversation
    .map((m) => `[${m.who}, ${m.age}]: ${m.text}`)
    .join("\n");

  const kbBlock = input.kbHints.length
    ? input.kbHints
        .map(
          (h, i) =>
            `[KB-${i + 1}] ${h.title}\n     Resolution: ${truncate(h.resolution, 240)}`
        )
        .join("\n")
    : "(no pinned KB articles for this ticket)";

  const tagsBlock = input.tags.length ? input.tags.join(", ") : "none";

  return `You are an experienced operations engineer at a US fintech, helping a field agent at a branch in ${countryName(input.agentCountry)} via a shared inbox.

Conversation so far (most recent last). Inbound messages were originally in the agent's language and have been auto-translated to English for you:
${convoBlock}

Ticket context:
- Agent: ${input.agentName} at ${input.branchName}
- Category: ${input.category} · Severity: ${input.severity}
- Tags: ${tagsBlock}

Relevant knowledge-base hints for this kind of issue:
${kbBlock}

Generate exactly THREE candidate reply drafts the operator could send to the agent. Each draft should:
- Be written in English (it will be auto-translated to ${langName(input.agentCountry)} before sending, so write naturally in English)
- Be 1–3 sentences, concrete and actionable
- Offer a specific next step, not a generic acknowledgement
- Match the technical level of the conversation

Vary the THREE drafts in tone:
1. "direct" — confident, action-first
2. "empathetic" — acknowledges frustration before the action
3. "investigative" — asks a clarifying question to gather more info

Reply with ONLY a JSON object. No prose, no markdown fences.

Shape:
{
  "suggestions": [
    { "tone": "direct",         "text": "..." },
    { "tone": "empathetic",     "text": "..." },
    { "tone": "investigative",  "text": "..." }
  ]
}`;
}

function parseSuggestions(raw: string): ReplySuggestion[] {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as { suggestions?: ReplySuggestion[] };
    if (!Array.isArray(parsed.suggestions)) return [];
    return parsed.suggestions
      .filter(
        (s): s is ReplySuggestion =>
          !!s && typeof s.text === "string" && typeof s.tone === "string"
      )
      .slice(0, 3);
  } catch {
    console.error("  ✗ Failed to parse reply-suggester output:", raw.slice(0, 200));
    return [];
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function countryName(code: string): string {
  if (code === "HT") return "Haiti";
  if (code === "DO") return "the Dominican Republic";
  if (code === "CD") return "the DRC";
  return code;
}

function langName(code: string): string {
  // The dashboard composer always writes in English; the outbound
  // translation step uses the agent's *detected* conversation language.
  // Here we just hint at the likely target so Claude knows what register
  // the operator's text will end up in.
  if (code === "HT") return "Haitian Creole";
  if (code === "DO") return "Spanish";
  if (code === "CD") return "French";
  return "the agent's language";
}
