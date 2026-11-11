# Bitimax bot — build with the REPOSITORY ROOT as context (the bot compiles the shared domain
# code from ../backend):   docker build -f bot/Dockerfile -t bitimax-bot .
FROM node:20-alpine AS build
WORKDIR /app/bot
COPY bot/package*.json ./
RUN npm ci
COPY bot/tsconfig.json ./
COPY bot/src ./src
COPY backend/src /app/backend/src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app/bot
ENV NODE_ENV=production SERVICE_ROLE=bot
RUN addgroup -S bitimax && adduser -S bitimax -G bitimax
COPY --from=build --chown=bitimax:bitimax /app/bot/node_modules ./node_modules
COPY --from=build --chown=bitimax:bitimax /app/bot/dist ./dist
COPY --chown=bitimax:bitimax bot/package.json ./
USER bitimax
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3002)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/bot/src/index.js"]
