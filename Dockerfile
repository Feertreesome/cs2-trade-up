# syntax=docker/dockerfile:1

########################
# Builder
########################
FROM node:20-alpine AS builder
WORKDIR /app

# OpenSSL до npm ci, чтобы Prisma подтянула правильные бинарники
RUN apk add --no-cache libssl3 openssl

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --include=dev

COPY . .

# prisma generate (нужен prisma из devDeps)
RUN npm run -w cs2-tradeup-ev-server prisma:generate
# build (нужен typescript из devDeps)
RUN npm run -w cs2-tradeup-ev-server build

########################
# Runtime
########################
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 \
    DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

RUN apk add --no-cache libssl3 openssl

# то, что нужно для старта
COPY package.json ./
COPY server/package.json ./server/package.json

# node_modules из builder (тут остаются и prisma, и @prisma/client)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

# dist для запуска
COPY --from=builder /app/server/dist ./server/dist

# ⬇️ ВАЖНО: схема нужна в runtime, если будут миграции на старте
COPY --from=builder /app/server/prisma ./server/prisma

EXPOSE 5174
# если миграции на старте — запускаем их тут
CMD ["sh","-lc","npm run -w cs2-tradeup-ev-server prisma:migrate --if-present && node server/dist/index.js"]
