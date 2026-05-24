import { prisma } from "./database";

// Given an incident id, read its contributing tickets and ask Claude
// Haiku to generate a descriptive title and a one-paragraph root-cause
// hypothesis. The clusterer's default title is mechanical
// ("Bug Report surge — Haiti"); this rewrites it to something an
// on-call operator can actually scan, like
// "Lottery results failing to load across Cap-Haïtien branches".
//
// Fails silently — incidents always exist with their mechanical title
// before this runs, so a Claude outage means the incident just keeps
// the generic name rather than breaking the cluster flow.

interface SummaryOutput {
  title: string;
  rootCause: string;
}

export async function summarizeIncident(incidentId: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("  ⚠ No ANTHROPIC_API_KEY — incident summarizer skipped");
    return;
  }

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      tickets: {
        select: {
          id: true,
          category: true,
          severity: true,
          tags: true,
          agent: {
            select: {
              country: true,
              branch: { select: { name: true, region: true } },
            },
          },
          messages: {
            where: { direction: "inbound" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { translatedText: true, originalText: true },
          },
        },
      },
    },
  });

  if (!incident) return;
  if (incident.tickets.length === 0) return;

  // Build a compact prompt: one bullet per contributing ticket with the
  // agent's first message + branch context.
  const ticketLines = incident.tickets.map((t, i) => {
    const text =
      t.messages[0]?.translatedText ?? t.messages[0]?.originalText ?? "(no message)";
    const branch = `${t.agent.branch.name} (${t.agent.branch.region})`;
    const tags = (t.tags ?? []).length ? ` [${t.tags.join(", ")}]` : "";
    return `${i + 1}. ${branch}: "${truncate(text, 160)}"${tags}`;
  });

  const branchSet = new Set(
    incident.tickets.map((t) => t.agent.branch.name)
  );
  const countrySet = new Set(
    incident.tickets.map((t) => t.agent.country)
  );

  const prompt = `You are an on-call operations engineer. Several field agents have reported similar issues in the last 30 minutes and the system has automatically clustered them into one incident. Read the reports and write a short summary.

Contributing tickets (${incident.tickets.length} total, ${branchSet.size} branches affected in ${Array.from(countrySet).join(", ")}):
${ticketLines.join("\n")}

Category: ${incident.category} · Severity: ${incident.severity}

Write a JSON object with two fields:
- "title": one short, specific sentence (max 80 characters) describing what is happening. Mention the specific feature/component if you can infer it. Examples of good titles: "Lottery results page failing to load across Cap-Haïtien branches", "Login screen crashes on Android app version 4.2.1". Avoid generic titles like "App is broken".
- "rootCause": 1–3 sentences hypothesizing the likely cause AND suggesting one concrete next step for the on-call engineer to investigate. Be specific to what the reports describe; do not invent details that aren't in the reports.

Reply with ONLY the JSON object. No prose, no markdown fences.

Shape:
{
  "title": "...",
  "rootCause": "..."
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
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`  ✗ Claude incident-summarizer error: ${response.status}`);
      return;
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
    };
    const raw = data.content?.[0]?.text ?? "";
    const parsed = parseSummary(raw);
    if (!parsed) return;

    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        title: parsed.title,
        rootCause: parsed.rootCause,
      },
    });

    console.log(
      `  🧠 Incident ${incidentId.slice(0, 8)} retitled: "${parsed.title}"`
    );
  } catch (err) {
    console.error("  ✗ incident-summarizer failed:", err);
  }
}

function parseSummary(raw: string): SummaryOutput | null {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as Partial<SummaryOutput>;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
    if (typeof parsed.rootCause !== "string" || !parsed.rootCause.trim()) return null;
    // Cap title at 120 chars so a runaway response doesn't break the UI.
    return {
      title: parsed.title.slice(0, 120),
      rootCause: parsed.rootCause,
    };
  } catch {
    console.error("  ✗ Failed to parse incident-summarizer output:", raw.slice(0, 200));
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
