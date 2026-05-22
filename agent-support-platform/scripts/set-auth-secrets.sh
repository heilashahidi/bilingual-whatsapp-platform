#!/usr/bin/env zsh
# Wires NextAuth + Google OAuth into local development AND Fly production.
#
# Run from agent-support-platform/. Prompts interactively for the Google
# Client ID and Client Secret. Generates a shared NEXTAUTH_SECRET that's
# used by both the dashboard (to sign JWTs) and the API (to verify them).

set -e

if [[ ! -f apps/api/.env || ! -f fly.api.toml || ! -f fly.dashboard.toml ]]; then
  echo "✗ Run from the agent-support-platform/ directory" >&2
  exit 1
fi

echo "→ Paste your Google OAuth credentials. Input is hidden."
read -s "GOOGLE_CLIENT_ID?Google CLIENT ID: "
echo
read -s "GOOGLE_CLIENT_SECRET?Google CLIENT SECRET: "
echo

if [[ -z "$GOOGLE_CLIENT_ID" || -z "$GOOGLE_CLIENT_SECRET" ]]; then
  echo "✗ One of the credentials is empty" >&2
  exit 1
fi

# Generate a single NEXTAUTH_SECRET shared by dashboard + API.
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# ─── Local: dashboard .env.local ────────────────────────────
cat > apps/dashboard/.env.local <<DASH_EOF
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
DASH_EOF
echo "✓ Wrote apps/dashboard/.env.local"

# ─── Local: API .env (append NEXTAUTH_SECRET if missing) ────
if grep -q "^NEXTAUTH_SECRET=" apps/api/.env; then
  # Replace existing value
  sed -i '' "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$NEXTAUTH_SECRET\"|" apps/api/.env
else
  echo "" >> apps/api/.env
  echo "# Shared with the dashboard — used to verify the Bearer JWT on every API call" >> apps/api/.env
  echo "NEXTAUTH_SECRET=\"$NEXTAUTH_SECRET\"" >> apps/api/.env
fi
echo "✓ Updated apps/api/.env with NEXTAUTH_SECRET"

# ─── Fly: API secrets ───────────────────────────────────────
echo "→ Setting Fly secrets on the API app..."
fly secrets set --config fly.api.toml --stage \
  NEXTAUTH_SECRET="$NEXTAUTH_SECRET" >/dev/null
echo "✓ API secrets staged"

# ─── Fly: Dashboard secrets ─────────────────────────────────
echo "→ Setting Fly secrets on the dashboard app..."
fly secrets set --config fly.dashboard.toml --stage \
  NEXTAUTH_URL="https://asp-dashboard-heila.fly.dev" \
  NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
  GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" >/dev/null
echo "✓ Dashboard secrets staged"

echo ""
echo "✓ All set."
echo ""
echo "Next steps:"
echo "  1. Restart the local API:    pkill -f 'tsx watch' || true; (cd apps/api && pnpm dev &)"
echo "  2. Restart the local dashboard (it auto-reloads on .env changes — but force a restart to be safe)"
echo "  3. Sign in at http://localhost:3000 (you'll be redirected to /signin)"
echo "  4. Once local works:  fly deploy --config fly.api.toml && fly deploy --config fly.dashboard.toml"
