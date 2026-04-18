export const now = (): number => Date.now();

export const isExpired = (timestampMs: number, skewMs = 0): boolean =>
  now() + skewMs >= timestampMs;
