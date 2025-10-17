# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

WORKDIR /app

ENV NODE_ENV=production \
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 \
    DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

RUN npm ci

COPY . .

RUN npm --workspace=cs2-tradeup-ev-server run prisma:generate \
 && npm --workspace=cs2-tradeup-ev-server run build

EXPOSE 5174

CMD ["node", "server/dist/index.js"]
