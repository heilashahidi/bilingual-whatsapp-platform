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

export interface IncidentSummaryOutput {
  title: string;
  rootCause: string;
}

export interface IncidentTicketForSummary {
  branchName: string;
  branchRegion: string | null;
  country: string;
  firstMessageText: string;
  tags: string[];
}

export interface IncidentSummaryContext {
  category: string | null;
  severity: string;
  tickets: IncidentTicketForSummary[];
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

  const context: IncidentSummaryContext = {
    category: incident.category,
    severity: incident.severity,
    tickets: incident.tickets.map((t) => ({
      branchName: t.agent.branch.name,
      branchRegion: t.agent.branch.region,
      country: t.agent.country,
      firstMessageText:
        t.messages[0]?.translatedText ?? t.messages[0]?.originalText ?? "(no message)",
      tags: t.tags ?? [],
    })),
  };

  const parsed = await generateIncidentSummary(context);
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
}

// Pure LLM-calling path: takes already-assembled context, asks Claude for a
// title + root-cause hypothesis. Exported so evals can target it directly
// without needing a populated database.
export async function generateIncidentSummary(
  context: IncidentSummaryContext
): Promise<IncidentSummaryOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const ticketLines = context.tickets.map((t, i) => {
    const branch = t.branchRegion ? `${t.branchName} (${t.branchRegion})` : t.branchName;
    const tags = t.tags.length ? ` [${t.tags.join(", ")}]` : "";
    return `${i + 1}. ${branch}: "${truncate(t.firstMessageText, 160)}"${tags}`;
  });

  const branchSet = new Set(context.tickets.map((t) => t.branchName));
  const countrySet = new Set(context.tickets.map((t) => t.country));

  const prompt = `You are an on-call operations engineer. Several field agents have reported similar issues in the last 30 minutes and the system has automatically clustered them into one incident. Read the reports and write a short summary.

Contributing tickets (${context.tickets.length} total, ${branchSet.size} branches affected in ${Array.from(countrySet).join(", ")}):
${ticketLines.join("\n")}

Category: ${context.category ?? "unknown"} · Severity: ${context.severity}

Write a JSON object with two fields:
- "title": one short, specific sentence (max 80 characters) describing what is happening. Mention the specific feature/component if you can infer it. Examples of good titles: "Lottery results page failing to load across Cap-Haïtien branches", "Login screen crashes on Android app version 4.2.1". Avoid generic titles like "App is broken".
- "rootCause": 1–2 sentences with exactly:
  (a) ONE primary hypothesis tied to report evidence (no laundry list),
  (b) ONE first verification step the on-call engineer should run now.
  Be specific to what the reports describe; do not invent details that aren't in the reports.

Connectivity clustering rule:
- If reports mostly indicate agent-side connectivity symptoms (weak signal, bad wifi, spotty mobile data) across different countries/regions/branches, treat it as likely independent local network issues rather than one platform outage.
- In that case, make the root cause explicitly say this likely should not be treated as a single platform incident and suggest triage/suppression guidance as the first step.

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
      return null;
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
    };
    const raw = data.content?.[0]?.text ?? "";
    return parseSummary(raw);
  } catch (err) {
    console.error("  ✗ incident-summarizer failed:", err);
    return null;
  }
}

function parseSummary(raw: string): IncidentSummaryOutput | null {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as Partial<IncidentSummaryOutput>;
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
