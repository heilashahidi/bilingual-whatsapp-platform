// Slack incoming-webhook poster. Logs to console when SLACK_WEBHOOK_URL is
// unset (dev mode). See https://api.slack.com/messaging/webhooks.

export interface SlackMessage {
  text: string; // fallback for notifications
  blocks?: unknown[];
  // Incoming webhooks are channel-bound, so "routing to a specific channel"
  // means using a different webhook URL. Callers can override the default
  // SLACK_WEBHOOK_URL with their own env var name (e.g.
  // SLACK_QUARANTINE_WEBHOOK_URL for the #agent-security channel).
  webhookUrlEnv?: string;
}

export async function sendSlackMessage(message: SlackMessage): Promise<void> {
  const url =
    (message.webhookUrlEnv && process.env[message.webhookUrlEnv]) ||
    process.env.SLACK_WEBHOOK_URL;

  if (!url) {
    console.log(`  [SLACK STUB] would post: ${message.text.substring(0, 120)}`);
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      console.error(`  ✗ Slack webhook returned ${res.status}`);
    }
  } catch (err) {
    console.error("  ✗ Slack webhook failed:", err);
  }
}
