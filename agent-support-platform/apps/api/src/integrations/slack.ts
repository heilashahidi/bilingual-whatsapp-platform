// Slack incoming-webhook poster.
// Stub mode when SLACK_WEBHOOK_URL is unset: logs to console.
//
// To go live: create an Incoming Webhook in your Slack workspace
// (https://api.slack.com/messaging/webhooks), copy the URL into
// SLACK_WEBHOOK_URL on the API's env / Fly secrets.
//
// We use the standard "blocks" payload format so the message can carry
// title, severity badge, and a Dashboard link as a button.

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
