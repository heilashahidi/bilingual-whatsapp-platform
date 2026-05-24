// Minimal Claude-as-judge helper. Lives here (not in src/) because evals are
// dev-only and shouldn't leak into the production bundle. Uses the same
// Anthropic REST surface as the production translator for parity.

interface JudgeArgs {
  prompt: string;
  maxTokens?: number;
}

interface JudgeResult {
  score: number;
  rationale: string;
}

export async function judgeWithClaude({ prompt, maxTokens = 200 }: JudgeArgs): Promise<JudgeResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Sonnet for judging — follows the rubric more strictly than Haiku,
      // especially the "wrong language ⇒ 0.0" hard constraint. Cost is fine
      // because evals run infrequently (~40 judge calls per full run).
      model: "claude-sonnet-4-5-20250929",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { content?: Array<{ text?: string }> };
  const raw = data.content?.[0]?.text || "";

  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean) as { score?: number; rationale?: string };
  const score = typeof parsed.score === "number" ? parsed.score : 0;
  const final = { score: Math.max(0, Math.min(1, score)), rationale: parsed.rationale || "" };
  if (process.env.DEBUG_JUDGE) console.error("[judge]", JSON.stringify({ raw: parsed, final }));
  return final;
}
