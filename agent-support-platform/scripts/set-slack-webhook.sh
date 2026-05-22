#!/usr/bin/env zsh
# Wires a Slack Incoming Webhook into the API for critical/high ticket
# notifications. Sets both SLACK_WEBHOOK_URL and DASHBOARD_BASE_URL so
# the "Open ticket" button in messages links back to the dashboard.
#
# Run from the agent-support-platform/ directory.

set -e

if [[ ! -f fly.api.toml ]]; then
  echo "✗ Run from the agent-support-platform/ directory" >&2
  exit 1
fi

echo "→ Paste your Slack Incoming Webhook URL. Input is hidden."
echo "  (Looks like: https://hooks.slack.com/services/T.../B.../...)"
read -s "SLACK_URL?SLACK_WEBHOOK_URL: "
echo

if [[ -z "$SLACK_URL" ]]; then
  echo "✗ Empty input" >&2
  exit 1
fi

if [[ "$SLACK_URL" != https://hooks.slack.com/* ]]; then
  echo "⚠  That doesn't look like a Slack webhook URL. Expected to start with https://hooks.slack.com/" >&2
  echo "   Continue anyway? (y/N): "
  read CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    exit 1
  fi
fi

# Default to the current Fly dashboard URL; customize once you set up
# a custom domain.
DASHBOARD_URL="${DASHBOARD_BASE_URL:-https://asp-dashboard-heila.fly.dev}"

echo "→ Setting Fly secrets on the API app..."
fly secrets set --config fly.api.toml \
  SLACK_WEBHOOK_URL="$SLACK_URL" \
  DASHBOARD_BASE_URL="$DASHBOARD_URL" >/dev/null
echo "✓ Slack webhook + dashboard URL set on Fly"

# Also write to local .env so dev mode can fire real Slack pings if
# you want (otherwise the stub just logs to console).
if [[ -f apps/api/.env ]]; then
  if grep -q "^SLACK_WEBHOOK_URL=" apps/api/.env; then
    sed -i '' "s|^SLACK_WEBHOOK_URL=.*|SLACK_WEBHOOK_URL=\"$SLACK_URL\"|" apps/api/.env
  else
    echo "" >> apps/api/.env
    echo "# Slack Incoming Webhook for critical/high ticket pings" >> apps/api/.env
    echo "SLACK_WEBHOOK_URL=\"$SLACK_URL\"" >> apps/api/.env
  fi
  if grep -q "^DASHBOARD_BASE_URL=" apps/api/.env; then
    sed -i '' "s|^DASHBOARD_BASE_URL=.*|DASHBOARD_BASE_URL=\"$DASHBOARD_URL\"|" apps/api/.env
  else
    echo "DASHBOARD_BASE_URL=\"$DASHBOARD_URL\"" >> apps/api/.env
  fi
  echo "✓ apps/api/.env updated"
fi

echo ""
echo "Next: trigger a critical or high WhatsApp message and watch your"
echo "Slack channel for the ping. Production picked up the secret as a"
echo "stage; restart the API machine to apply, or wait for the next deploy."
echo ""
echo "Restart now:"
echo "  fly machine restart --config fly.api.toml -s"
