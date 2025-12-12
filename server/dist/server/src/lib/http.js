"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitError = exports.http = void 0;
const axios_1 = __importDefault(require("axios"));
exports.http = axios_1.default.create({
    timeout: 20000,
    headers: { "User-Agent": "cs2-tradeup-ev/0.5" },
});
function parseRetryAfter(header) {
    if (!header)
        return undefined;
    const secs = Number(header);
    if (!Number.isNaN(secs))
        return secs * 1000;
    const when = Date.parse(header);
    return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}
class RateLimitError extends Error {
    constructor(message, retryAfterMs) {
        super(message);
        this.name = "RateLimitError";
        this.retryAfterMs = retryAfterMs;
    }
}
exports.RateLimitError = RateLimitError;
exports.http.interceptors.response.use((r) => r, (err) => {
    const status = err?.response?.status;
    if (status === 429) {
        const ra = parseRetryAfter(err?.response?.headers?.["retry-after"]);
        throw new RateLimitError("Rate limited", ra ?? 60000);
    }
    throw err;
});
