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
To refresh the covert collection float catalog run:

```
pnpm sync:floats
```

The command downloads the latest dataset from ByMykel/CSGO-API, filters covert skins with collection bindings, and regenerates `data/CollectionsWithFloat.ts`. Restart the server after syncing to ensure in-memory caches are rebuilt.
