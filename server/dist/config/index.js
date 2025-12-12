"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATE_MAX_MS = exports.RATE_MIN_MS = exports.START_RATE_MS = exports.STEAM_MAX_AUTO_LIMIT = exports.STEAM_PAGE_SIZE = void 0;
/**
 * Глобальные константы конфигурации сервера и лимитов запросов к Steam.
 * Значения можно переопределить через переменные окружения.
 */
exports.STEAM_PAGE_SIZE = Math.max(20, Math.min(80, Number(process.env.STEAM_PAGE_SIZE || 30)));
exports.STEAM_MAX_AUTO_LIMIT = Math.max(500, Math.min(5000, Number(process.env.STEAM_MAX_AUTO_LIMIT || 1200))); // «мягкий» cap
exports.START_RATE_MS = Math.max(800, Number(process.env.STEAM_RATE_MS || 3000));
exports.RATE_MIN_MS = 1000;
exports.RATE_MAX_MS = 4000;
