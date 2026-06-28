// Best-effort in-memory fixed-window rate limiter.
//
// NOTE: Worker isolates are not shared globally, so this limits per-isolate, not
// truly per-account. It is a cheap abuse guard for the public endpoint. For a
// strict global limit, migrate to a Durable Object or KV-backed counter (see
// docs/SECURITY.md). It must never throw and must fail open.

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export function checkRateLimit(key: string, limitPerMinute: number, now: number = Date.now()): RateLimitResult {
  if (!Number.isFinite(limitPerMinute) || limitPerMinute <= 0) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetInSeconds: 0 };
  }
  let win = buckets.get(key);
  if (!win || now >= win.resetAt) {
    win = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, win);
  }
  win.count += 1;

  // Opportunistic cleanup to bound memory.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k);
    }
  }

  const remaining = Math.max(0, limitPerMinute - win.count);
  const resetInSeconds = Math.ceil((win.resetAt - now) / 1000);
  return { allowed: win.count <= limitPerMinute, remaining, resetInSeconds };
}

/** Test helper: clear all buckets. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
