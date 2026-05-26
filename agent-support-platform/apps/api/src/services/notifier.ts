import { prisma } from "./database";
import { sendSlackMessage } from "../integrations/slack";

// Translates platform events into Slack pings. Each function is fire-
// and-forget — never block the request pipeline waiting on Slack.

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🚨",
  high: "⚠️",
  medium: "📢",
  low: "ℹ️",
};

// Fires when someone @-mentions a teammate in an internal note. Posts a
// formatted Slack message naming the mentioned user + author + snippet.
// Skipped silently when no mentions or when the mentioned users can't be
// found in InternalUser.

export async function notifyMention(input: {
  ticketId: string;
  noteId: string;
  authorEmail: string | null;
  authorName: string | null;
  mentionedUserIds: string[];
  snippet: string;
}): Promise<void> {
  if (input.mentionedUserIds.length === 0) return;

  const users = await prisma.internalUser.findMany({
    where: { id: { in: input.mentionedUserIds } },
    select: { id: true, name: true, email: true },
  });
  if (users.length === 0) return;

  const dashboardUrl = process.env.DASHBOARD_BASE_URL
    ? `${process.env.DASHBOARD_BASE_URL}/tickets?ticket=${input.ticketId}`
    : null;

  const mentionedList = users.map((u) => u.name).join(", ");
  const author = input.authorName || input.authorEmail || "Someone";
  const text = `📣 ${author} mentioned ${mentionedList}: "${input.snippet.slice(0, 200)}"`;

  await sendSlackMessage({
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📣 *${author}* mentioned *${mentionedList}* in an internal note`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `> ${input.snippet.slice(0, 500)}` },
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
                },
              ],
            },
          ]
        : []),
    ],
  });
}

// SECURITY.md §5.1 — fires when an unverified or rejected number sends an
// inbound message. Goes to a dedicated #agent-security channel (configured
// via SLACK_WEBHOOK_URL_SECURITY; falls back to the default channel if
// unset). The point is to make scam-attempt traffic visible to admins
// without polluting #agent-issues with operator noise.
export async function notifyQuarantinedMessage(input: {
  agentId: string;
  ticketId: string;
  agentPhone: string;
  agentCountry: string;
  profileName: string | null;
  reason: "unverified" | "rejected";
  messageSnippet: string;
}): Promise<void> {
  const dashboardUrl = process.env.DASHBOARD_BASE_URL
    ? `${process.env.DASHBOARD_BASE_URL}/agents?verification=${input.reason === "rejected" ? "rejected" : "pending"}&highlight=${input.agentId}`
    : null;

  const reasonText =
    input.reason === "rejected"
      ? "🚫 *Message from a rejected number* (previously flagged as a scammer/spammer)"
      : "🕵️ *Message from an unverified number* (not yet promoted to a known agent)";

  await sendSlackMessage({
    webhookUrlEnv: "SLACK_QUARANTINE_WEBHOOK_URL",
    text: `Quarantined inbound from ${input.agentPhone} (${input.agentCountry}): "${input.messageSnippet.slice(0, 200)}"`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: reasonText } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*From:* ${input.agentPhone} (${input.agentCountry})${input.profileName ? ` · profile "${input.profileName}"` : ""}\n*Message:* ${input.messageSnippet.slice(0, 500)}`,
        },
      },
      ...(dashboardUrl
        ? [
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Review in quarantine" },
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
