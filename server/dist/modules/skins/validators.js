"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBoolean = void 0;
/** Boolean parser for query parameters with a default fallback. */
const parseBoolean = (value, defaultValue = false) => {
    const text = String(value ?? "");
    if (/^(1|true|yes|on)$/i.test(text))
        return true;
    if (/^(0|false|no|off)$/i.test(text))
        return false;
    return defaultValue;
};
exports.parseBoolean = parseBoolean;
