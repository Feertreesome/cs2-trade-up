"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisConnection = void 0;
const defaultRedisUrl = "redis://localhost:6379";
const parseRedisUrl = (rawUrl) => {
    try {
        const url = new URL(rawUrl);
        const tls = url.protocol === "rediss:" ? {} : undefined;
        return {
            host: url.hostname,
            port: url.port ? Number(url.port) : 6379,
            username: url.username || undefined,
            password: url.password || undefined,
            tls,
        };
    }
    catch (error) {
        console.warn(`Invalid REDIS_URL provided (${rawUrl}), falling back to ${defaultRedisUrl}.`, error);
        return parseRedisUrl(defaultRedisUrl);
    }
};
exports.redisConnection = parseRedisUrl(process.env.REDIS_URL || defaultRedisUrl);
