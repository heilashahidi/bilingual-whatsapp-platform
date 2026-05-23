#!/usr/bin/env zsh
# Wires NextAuth + Google OAuth into LOCAL development.
#
# Run from agent-support-platform/. Prompts interactively for the Google
# Client ID and Client Secret. Generates a shared NEXTAUTH_SECRET that's
# used by both the dashboard (to sign JWTs) and the API (to verify them).
#
# For production (Railway), copy the generated NEXTAUTH_SECRET into the
# Variables tab of BOTH services manually. There is no Railway CLI
# automation in this script — we keep secret handling explicit and
# auditable.

set -e

if [[ ! -f apps/api/.env ]]; then
  echo "✗ Run from the agent-support-platform/ directory (apps/api/.env not found)" >&2
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

echo ""
echo "✓ Local auth configured."
echo ""
echo "Next steps:"
echo "  1. Restart the local API:    pkill -f 'tsx watch' || true; (cd apps/api && pnpm dev &)"
echo "  2. Restart the local dashboard (it auto-reloads on .env changes — but force a restart to be safe)"
echo "  3. Sign in at http://localhost:3000 (you'll be redirected to /signin)"
echo ""
echo "For Railway (production), update these variables on BOTH services"
echo "in the Railway dashboard Variables tab. Use the same NEXTAUTH_SECRET"
echo "value on both — they need to match for JWT verification to work."
echo ""
echo "  NEXTAUTH_SECRET=$NEXTAUTH_SECRET"
echo "  GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
echo "  GOOGLE_CLIENT_SECRET=<your secret>"
echo ""
echo "  Dashboard service also needs:"
echo "    NEXTAUTH_URL=https://nclusion-inbox-production.up.railway.app"
echo "    NEXT_PUBLIC_API_URL=https://nclusion-api.up.railway.app"
