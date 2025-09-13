/**
 * Глобальные константы конфигурации сервера и лимитов запросов к Steam.
 * Значения можно переопределить через переменные окружения.
 */
export const STEAM_PAGE_SIZE = Math.max(20, Math.min(80, Number(process.env.STEAM_PAGE_SIZE || 30)));
export const STEAM_MAX_AUTO_LIMIT = Math.max(500, Math.min(5000, Number(process.env.STEAM_MAX_AUTO_LIMIT || 1200))); // «мягкий» cap
export const START_RATE_MS = Math.max(800, Number(process.env.STEAM_RATE_MS || 3000));
export const RATE_MIN_MS = 1000;
export const RATE_MAX_MS = 4000;
