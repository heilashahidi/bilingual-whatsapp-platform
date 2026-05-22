#!/usr/bin/env zsh
# Sets all secrets for the API Fly app in one batch.
# Run from the agent-support-platform/ directory.
# Reads two URLs interactively; pulls Twilio + Anthropic creds from apps/api/.env.

set -e

# Sanity: must be in the project root
if [[ ! -f apps/api/.env || ! -f fly.api.toml ]]; then
  echo "✗ Run this from the agent-support-platform/ directory" >&2
  exit 1
fi

# Prompt for the two URLs that aren't in .env
read -s "NEON_URL?Neon DATABASE_URL: "
echo
read -s "UPSTASH_URL?Upstash REDIS_URL: "
echo

if [[ -z "$NEON_URL" || -z "$UPSTASH_URL" ]]; then
  echo "✗ One of the URLs is empty — paste again" >&2
  exit 1
fi

# Pull the other creds from local .env
TWILIO_ACCOUNT_SID=$(grep ^TWILIO_ACCOUNT_SID apps/api/.env | cut -d'"' -f2)
TWILIO_AUTH_TOKEN=$(grep ^TWILIO_AUTH_TOKEN apps/api/.env | cut -d'"' -f2)
ANTHROPIC_API_KEY=$(grep ^ANTHROPIC_API_KEY apps/api/.env | cut -d'"' -f2)

if [[ -z "$TWILIO_ACCOUNT_SID" || -z "$ANTHROPIC_API_KEY" ]]; then
  echo "✗ Couldn't read Twilio/Anthropic creds from apps/api/.env" >&2
  exit 1
fi

# Build a temp file with NAME=VALUE per line, then import in one shot.
SECRETS_FILE=$(mktemp)
trap "rm -f $SECRETS_FILE" EXIT

cat >"$SECRETS_FILE" <<SECRETS_EOF
DATABASE_URL=$NEON_URL
REDIS_URL=$UPSTASH_URL
USE_REAL_WHATSAPP=true
USE_REAL_CLASSIFICATION=true
USE_REAL_TRANSLATION=true
TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_NUMBER=+14155238886
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
WEBHOOK_BASE_URL=https://heilashahidi.fly.dev
TEST_AGENT_COUNTRY=HT
SECRETS_EOF

echo "→ Importing $(wc -l <"$SECRETS_FILE") secrets to Fly app heilashahidi..."
fly secrets import --config fly.api.toml <"$SECRETS_FILE"
echo "✓ Done"
