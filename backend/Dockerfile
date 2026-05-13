# syntax=docker/dockerfile:1.6

# --- Stage 1: install production deps ---
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# --- Stage 2: runtime ---
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Add a non-root user
RUN addgroup -S app && adduser -S app -G app

# OpenSSL needed by Prisma engines on alpine
RUN apk add --no-cache openssl bash postgresql-client

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package*.json ./
COPY src ./src
COPY scripts ./scripts

# Entrypoint runs migrations then starts the server.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p uploads && chown -R app:app /app
USER app

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
