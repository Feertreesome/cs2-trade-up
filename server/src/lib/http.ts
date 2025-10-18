import axios from "axios";

export const http = axios.create({
  timeout: 20_000,
  headers: { "User-Agent": "cs2-tradeup-ev/0.5" },
});

function parseRetryAfter(header?: string) {
  if (!header) return undefined;
  const secs = Number(header);
  if (!Number.isNaN(secs)) return secs * 1000;
  const when = Date.parse(header);
  return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}

export class RateLimitError extends Error {
  retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    if (status === 429) {
      const ra = parseRetryAfter(err?.response?.headers?.["retry-after"]);
      throw new RateLimitError("Rate limited", ra ?? 60_000);
    }
    throw err;
  },
);
