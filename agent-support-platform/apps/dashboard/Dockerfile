# syntax=docker/dockerfile:1
# Build context: the agent-support-platform/ monorepo root.

FROM node:20-slim AS base
RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

# ─── Builder ────────────────────────────────────────────────
FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/dashboard ./apps/dashboard

# NEXT_PUBLIC_API_URL is inlined into the client bundle at build time.
# Pass via --build-arg or fly.toml's [build.args].
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN cd apps/dashboard && pnpm exec next build

# ─── Runner ─────────────────────────────────────────────────
# Uses Next.js standalone output (needs `output: 'standalone'` in next.config).
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# The standalone bundle places its entry at apps/dashboard/server.js
# (Next.js preserves the monorepo path structure inside the bundle).
COPY --from=builder /repo/apps/dashboard/.next/standalone ./
COPY --from=builder /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static

# Bind to all interfaces so Fly's proxy can reach us
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/dashboard/server.js"]
