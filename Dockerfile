FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY expo/package.json expo/bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

# Copy backend source
COPY expo/backend/ ./backend/
COPY expo/lib/ ./lib/
COPY expo/types/ ./types/
COPY expo/services/ ./services/
COPY expo/constants/ ./constants/
COPY expo/tsconfig.json ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["bun", "run", "backend/server.ts"]
