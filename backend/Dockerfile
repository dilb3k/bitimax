# Bitimax backend — HTTP API + scheduler. The Telegram bot is a separate service (../bot).
#
# This is a long-running stateful service (Telegraf long-polling and setInterval sweeps),
# so it cannot run on a serverless platform. Any host that runs a container works:
# Railway, Render, Fly.io, a plain VPS with docker compose.

# ─── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the tree we're about to copy into the runtime image.
RUN npm prune --omit=dev

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user: this process holds the bot token and the credential
# encryption key, so a container escape should not also mean root.
RUN addgroup -S bitmax && adduser -S bitmax -G bitmax

COPY --from=build --chown=bitmax:bitmax /app/node_modules ./node_modules
COPY --from=build --chown=bitmax:bitmax /app/dist ./dist
COPY --chown=bitmax:bitmax package.json ./

USER bitmax

EXPOSE 3001

# The platform's own healthcheck should hit this too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
