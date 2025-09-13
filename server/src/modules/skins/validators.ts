/** Boolean parser for query parameters with a default fallback. */
export const parseBoolean = (value: unknown, defaultValue = false): boolean => {
  const text = String(value ?? "");
  if (/^(1|true|yes|on)$/i.test(text)) return true;
  if (/^(0|false|no|off)$/i.test(text)) return false;
  return defaultValue;
};
