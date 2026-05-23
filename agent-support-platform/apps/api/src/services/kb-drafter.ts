// Claude-powered helper for kb-indexer.ts. Reads a resolved ticket (the
// conversation + the operator's resolution summary) and produces a clean
// knowledge-base article draft. The operator approves on the /knowledge
// page before the draft becomes searchable.
//
// Fails by returning null. The caller (kb-indexer) falls back to the
// mechanical title + concatenation in that case, so KB drafts always
// get created even without Claude.

export interface KbDraft {
  title: string;
  problemDescription: string;
  resolutionText: string;
  resolutionTextShort: string;
  tags: string[];
}

interface TicketContext {
  category: string;
  productArea: string | null;
  classifierTags: string[];
  conversation: Array<{ who: "agent" | "operator"; text: string }>;
  resolutionSummary: string;
}

export async function draftKbArticle(
  ctx: TicketContext
): Promise<KbDraft | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("  ⚠ No ANTHROPIC_API_KEY — kb-drafter returning null");
    return null;
  }

  const convoBlock = ctx.conversation
    .map((m) => `[${m.who}]: ${m.text}`)
    .join("\n");

  const existingTagsBlock = ctx.classifierTags.length
    ? ctx.classifierTags.join(", ")
    : "(none)";

  const prompt = `You are writing a knowledge-base article from a real, resolved support ticket so future operators can find the fix faster.

The ticket conversation (inbound messages were originally in the field agent's language and auto-translated to English):
${convoBlock}

The operator's resolution summary (what actually fixed it):
"${ctx.resolutionSummary}"

Ticket metadata:
- Category: ${ctx.category}
- Product area: ${ctx.productArea ?? "unspecified"}
- Existing classifier tags: ${existingTagsBlock}

Write a JSON object representing the knowledge-base article. Be specific to what the ticket actually says — do NOT invent details that aren't in the conversation. If the resolution summary is vague, keep your article short rather than embellishing.

Required fields:
- "title": short and searchable, < 80 characters. Names the symptom + the affected component. Example: "Login screen shows 'Network error' after app update on Android".
- "problemDescription": 1–2 sentences in plain English describing what the agent observed.
- "resolutionText": numbered steps (use "1." "2." "3.") that another operator could follow. Concrete actions, no fluff.
- "resolutionTextShort": same content but compressed to ≤ 480 characters, suitable for sending to a low-bandwidth agent over WhatsApp.
- "tags": 2–5 lowercase keyword tags useful for search. Reuse any of the classifier tags above when they fit, plus product-specific terms from the conversation.

Reply with ONLY the JSON object. No prose, no markdown fences.

Shape:
{
  "title": "...",
  "problemDescription": "...",
  "resolutionText": "...",
  "resolutionTextShort": "...",
  "tags": ["...", "..."]
}`;

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
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`  ✗ Claude kb-drafter error: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
    };
    return parseDraft(data.content?.[0]?.text ?? "");
  } catch (err) {
    console.error("  ✗ kb-drafter failed:", err);
    return null;
  }
}

function parseDraft(raw: string): KbDraft | null {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as Partial<KbDraft>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.problemDescription !== "string" ||
      typeof parsed.resolutionText !== "string"
    ) {
      return null;
    }
    return {
      title: parsed.title.slice(0, 120),
      problemDescription: parsed.problemDescription,
      resolutionText: parsed.resolutionText,
      // If Claude forgot the short variant, derive it from the long one.
      resolutionTextShort:
        typeof parsed.resolutionTextShort === "string"
          ? parsed.resolutionTextShort.slice(0, 480)
          : parsed.resolutionText.length > 480
            ? parsed.resolutionText.slice(0, 477) + "…"
            : parsed.resolutionText,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.toLowerCase().trim())
            .filter((t) => t.length > 0)
            .slice(0, 8)
        : [],
    };
  } catch {
    console.error("  ✗ Failed to parse kb-drafter output:", raw.slice(0, 200));
    return null;
  }
}
