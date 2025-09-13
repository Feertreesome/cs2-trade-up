// Безопасные дефолты; можно переопределить через .env
export const STEAM_PAGE_SIZE = Math.min(80, Math.max(20, Number(process.env.STEAM_PAGE_SIZE) || 60));
export const STEAM_RATE_MS   = Number(process.env.STEAM_RATE_MS) || 4000;
// Жёсткий лимит на "limit=all", чтобы не словить 429 (повышай по необходимости)
export const STEAM_MAX_AUTO_LIMIT = Number(process.env.STEAM_MAX_AUTO_LIMIT) || 4000;
