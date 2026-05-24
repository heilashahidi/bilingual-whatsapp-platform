// Slack incoming-webhook poster. Logs to console when SLACK_WEBHOOK_URL is
// unset (dev mode). See https://api.slack.com/messaging/webhooks.

export interface SlackMessage {
  text: string; // fallback for notifications
  blocks?: unknown[];
}

export async function sendSlackMessage(message: SlackMessage): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;

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
