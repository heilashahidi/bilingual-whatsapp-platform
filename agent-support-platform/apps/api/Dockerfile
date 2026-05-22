# syntax=docker/dockerfile:1
# Build context: the agent-support-platform/ monorepo root.

FROM node:20-slim AS base
# Prisma needs openssl + ca-certs at runtime
RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

# ─── Builder ────────────────────────────────────────────────
# Install deps first (cached layer), then copy source, then prisma generate.
FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN cd apps/api && pnpm exec prisma generate

# ─── Runner ─────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
# Apply any pending migrations on boot, then start the server.
# tsx transpiles TS on demand — avoids a separate `tsc` build step
# and the workspace-package-resolution headaches it would cause.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx src/server.ts"]
