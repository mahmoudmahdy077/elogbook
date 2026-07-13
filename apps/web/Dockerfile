# syntax=docker/dockerfile:1
# Build context: repo root
# Build:  docker build -t elogbook-web -f apps/web/Dockerfile .
FROM node:20.11-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY packages/supabase/package.json ./packages/supabase/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY packages ./packages
COPY apps/web ./apps/web
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
RUN pnpm --filter @elogbook/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV PORT 3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
