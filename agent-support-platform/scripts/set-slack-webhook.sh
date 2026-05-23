#!/usr/bin/env zsh
# Writes a Slack Incoming Webhook URL into the LOCAL .env so dev-mode
# notifications fire real Slack pings (not just console logs).
#
# Run from the agent-support-platform/ directory.
#
# For production (Railway), copy the values printed at the end of this
# script into the Variables tab of the api service. There is no Railway
# CLI automation here — secret handling stays explicit.

set -e

if [[ ! -f apps/api/.env ]]; then
  echo "✗ Run from the agent-support-platform/ directory (apps/api/.env not found)" >&2
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

# Production dashboard URL — used in Slack "Open ticket" buttons.
DASHBOARD_URL="${DASHBOARD_BASE_URL:-https://dashboard-production-5d4e.up.railway.app}"

# ─── Local: API .env ────────────────────────────────────────
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

echo ""
echo "For Railway (production), set these two variables on the api service:"
echo ""
echo "  SLACK_WEBHOOK_URL=$SLACK_URL"
echo "  DASHBOARD_BASE_URL=$DASHBOARD_URL"
echo ""
echo "Then trigger a critical or high WhatsApp message and watch your"
echo "Slack channel for the ping."
