FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Build stage
FROM base AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY backend/ ./backend/
COPY lib/sentry.ts ./lib/sentry.ts
COPY lib/config.ts ./lib/config.ts
COPY types/ ./types/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "backend/server.ts"]
