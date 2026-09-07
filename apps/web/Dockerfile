# syntax=docker/dockerfile:1
# Build context: repo root
# Authoritative application image (T06). Root Dockerfile.web was removed:
# unreferenced by Compose/CI and containing invalid COPY syntax.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache bash curl postgresql-client

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY patches ./patches
COPY packages/shared/package.json ./packages/shared/
COPY packages/env/package.json ./packages/env/
COPY apps/web/package.json ./apps/web/
COPY packages/supabase/package.json ./packages/supabase/
COPY apps/ops/package.json ./apps/ops/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/mobile/scripts ./apps/mobile/scripts
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web
RUN NEXT_OUTPUT=standalone pnpm --filter @elogbook/web build

FROM node:22-alpine AS runner
RUN npm install -g tar@7.5.19 && rm -rf /usr/local/lib/node_modules/npm/node_modules/tar && cp -r /usr/local/lib/node_modules/tar /usr/local/lib/node_modules/npm/node_modules/tar
# postgresql-client lives in the runner (not just the builder): the app
# shells pg_dump/pg_restore for backups (lib/setup/backup-manager.ts).
# gzip comes from busybox. T07 owns replacing the shell pipeline.
RUN apk add --no-cache wget postgresql-client
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Non-root runtime (T06/F13).
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
# Full production dependency tree (not just the standalone trace): Next's
# file tracing misses dynamically-required packages under pnpm's isolated
# layout (observed: @swc/helpers via require-hook), so the traced server
# cannot boot alone. Node resolution walks up to /app/node_modules, which
# covers every workspace package. Slimming (e.g. pruned prod tree) is
# tracked with asset budgets; correctness first.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
CMD ["node", "apps/web/server.js"]
