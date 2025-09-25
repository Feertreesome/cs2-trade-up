export const formatNumber = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";

export const formatPercent = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
