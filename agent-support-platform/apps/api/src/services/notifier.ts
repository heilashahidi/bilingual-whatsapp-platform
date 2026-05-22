import { sendSlackMessage } from "../integrations/slack";

// Translates platform events into Slack pings. Each function is fire-
// and-forget — never block the request pipeline waiting on Slack.

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🚨",
  high: "⚠️",
  medium: "📢",
  low: "ℹ️",
};

export async function notifyNewTicket(input: {
  ticketId: string;
  severity: string;
  category: string;
  productArea: string | null;
  tags: string[];
  agentName: string;
  agentPhone: string;
  agentCountry: string;
  branchName: string;
  messageSnippet: string;
}): Promise<void> {
  // Only critical and high merit a Slack ping. Lower severities create
  // noise without value.
  if (input.severity !== "critical" && input.severity !== "high") return;

  const emoji = SEVERITY_EMOJI[input.severity] || "📢";
  const dashboardUrl = process.env.DASHBOARD_BASE_URL
    ? `${process.env.DASHBOARD_BASE_URL}/tickets/${input.ticketId}`
    : null;

  const tagText = input.tags.length
    ? `\n*Tags:* ${input.tags.map((t) => `\`${t}\``).join(" ")}`
    : "";

  const text = `${emoji} *${input.severity.toUpperCase()}* — ${input.category.replace(/_/g, " ")}: ${input.messageSnippet.slice(0, 200)}`;

  await sendSlackMessage({
    text, // plaintext fallback for mobile / desktop preview
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *New ${input.severity} ticket — ${input.category.replace(/_/g, " ")}*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Agent:* ${input.agentName} · ${input.branchName} · ${input.agentCountry}\n*Message:* ${input.messageSnippet.slice(0, 500)}${tagText}`,
        },
      },
      ...(dashboardUrl
        ? [
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Open ticket" },
                  url: dashboardUrl,
                  style: "primary",
                },
              ],
            },
          ]
        : []),
    ],
  });
}
