# ============================================================
#  Ajmera Fashion CRM — Docker deployment (optional alternative)
#  docker compose up -d --build
#  .env file project root me hona chahiye (deploy/.env.production.example dekho)
# ============================================================

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bunx prisma generate && bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000 3003
# Default: CRM app. Socket service docker-compose me alag command se chalta hai.
CMD ["bun", ".next/standalone/server.js"]
