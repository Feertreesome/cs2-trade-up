# CS2 Trade‑Up EV — Node + React (MVP)

## Требования

- Node.js 18+
- Docker + Docker Compose (опционально, для быстрого запуска всего стека)

## 0. Переменные окружения

Скопируйте пример настроек и подправьте его под свою среду:

```bash
cp server/.env.example server/.env
```

`DATABASE_URL` и `REDIS_URL` нужны как серверу, так и Prisma. Переменная `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`
позволяет генерировать Prisma Client даже в окружениях без доступа к официальному CDN (например, внутри Docker на
машинах без OpenSSL 1.1).

## 1. Установка зависимостей

```bash
npm install
npm --workspace=cs2-tradeup-ev-server run prisma:generate
```

Команда `prisma:generate` использует переменные из `server/.env`, поэтому запускать её нужно из корня репозитория (как
показано выше) либо из каталога `server/` после экспорта переменных.

## Быстрый старт через Docker Compose

1. Убедитесь, что зависимости установлены и Prisma Client сгенерирован (см. раздел выше).
2. Поднимите весь стек (PostgreSQL, Redis, API и воркер) одной командой:
   ```bash
   docker compose up
   ```
   При первом запуске Docker примонтирует текущий репозиторий внутрь контейнеров, и Node сразу использует локальные
   `node_modules`.
3. Инициализируйте схему базы данных (команда выполнится в контейнере API):
   ```bash
   docker compose exec api npm --workspace=cs2-tradeup-ev-server run prisma:migrate
   ```
4. После того как сервисы стартовали, инициируйте синхронизацию каталога:
   ```bash
   curl -X POST http://localhost:5174/api/tradeups/collections/sync
   ```
   Запрос вернёт идентификатор задания. Его статус можно проверять через
   `GET /api/tradeups/collections/sync/:jobId`.

## Локальная разработка без Docker

1. Поднимите PostgreSQL и Redis (можно через локальные сервисы или Docker). Убедитесь, что `DATABASE_URL` и `REDIS_URL`
   указывают на поднятые инстансы.
2. Выполните команды установки из раздела «Установка зависимостей».
3. Примените миграции:
   ```bash
   npm --workspace=cs2-tradeup-ev-server run prisma:migrate
   ```
4. Запустите API и фронтенд в режиме разработки:
   ```bash
   npm run dev
   ```
   Клиент откроется на `http://localhost:5173`, API будет доступен на `http://localhost:5174` (через прокси `/api`).
5. В отдельном терминале запустите воркер очереди:
   ```bash
   npm --workspace=cs2-tradeup-ev-server run worker
   ```
6. Инициируйте синхронизацию каталога через `POST /api/tradeups/collections/sync`, как и в Docker‑сценарии.

## Работа с данными

- `npm run sync:floats` — загружает актуальный список Covert‑скинов из
  [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), пересобирает `data/CollectionsWithFloat.ts` и обновляет
  локальные кэши trade-up каталога.
- После успешной синхронизации каталога данные эндпоинтов `/api/tradeups/collections/*` и `/api/skins/*` берутся из
  базы. Из Steam в онлайне запрашиваются только актуальные цены через `/api/priceoverview/batch`.
