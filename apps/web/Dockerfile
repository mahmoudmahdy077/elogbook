# syntax=docker/dockerfile:1
# Build context: repo root
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# CVE-2026-59873: replace all copies of bundled tar with patched version
RUN npm install -g tar@7.5.19 && \
    find /usr/local/lib/node_modules/npm -path "*/node_modules/tar" -type d \
      -exec sh -c 'for d; do rm -rf "$d" && cp -r /usr/local/lib/node_modules/tar "$d"; done' _ {} +

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/env/package.json ./packages/env/
COPY apps/web/package.json ./apps/web/
COPY packages/supabase/package.json ./packages/supabase/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web
RUN NEXT_OUTPUT=standalone pnpm --filter @elogbook/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
