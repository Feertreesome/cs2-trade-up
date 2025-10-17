# CS2 Trade‑Up EV — Node + React (MVP)

## Prereq
- Node 18+
- pnpm (or npm/yarn)

## Install
pnpm i -w
cd server && pnpm i && cd ../client && pnpm i && cd ..

## Dev
pnpm dev
# client on :5173, server on :5174 (proxy /api -> server)

## Build
cd server && pnpm run build
cd ../client && pnpm run build

## Data sync
- `npm run sync:floats` — загружает актуальный список Covert-скинов из [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API),
  пересобирает `data/CollectionsWithFloat.ts` и прогоняет обновлённые идентификаторы коллекций.
  После синхронизации перезапустите сервер, чтобы прогреть кеши trade-up каталога.

## Persistent catalog
- Для выгрузки и кэширования каталога Steam используется PostgreSQL + Redis (BullMQ). Перед запуском сервера
  выставьте `DATABASE_URL` (например, `postgresql://user:pass@localhost:5432/cs2?schema=public`) и `REDIS_URL`
  (`redis://localhost:6379`).
- Сгенерируйте Prisma Client: `cd server && npm run prisma:generate` (выполняется без подключения к БД).
- Для полной синхронизации каталога вызовите `POST /api/tradeups/collections/sync` — сервер вернёт идентификатор
  задания. Текущий статус доступен по `GET /api/tradeups/collections/sync/:jobId` или `GET /api/tradeups/collections/sync`.
- Задания обрабатываются воркером BullMQ (`npm --workspace cs2-tradeup-ev-server run worker`). API и воркер можно
  поднять одним
  `docker-compose up` (поднимутся PostgreSQL, Redis, сервер и воркер).
- После синка API `GET /api/tradeups/collections/*` и `GET /api/skins/*` обслуживаются из базы, обращения к Steam
  нужны только для актуализации цен через `/api/priceoverview/batch`.
