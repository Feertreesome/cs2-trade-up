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
