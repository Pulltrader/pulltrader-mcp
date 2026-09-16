// =============================================================================
// ABUSE GUARD — KV-backed global rate limits + data-tool budgets
// =============================================================================
// Protects the public MCP endpoint from anonymous abuse and Anthropic/comps
// spend. Coarse per-IP request limits fail OPEN if KV is unavailable (fee math
// should keep working). Data-tool budgets fail CLOSED (protect the bill).
//
// Keys (fixed windows):
//   rl:ip:{ip}:m:{floorMin}              — all POST /mcp (per IP / minute)
//   rl:ip:{ip}:d:{YYYYMMDD}:data         — data tools (per IP / day)
//   rl:ip:{ip}:dm:{floorMin}:data        — data tools (per IP / minute)
//   rl:global:d:{YYYYMMDD}:data          — data tools (global / day circuit breaker)
// =============================================================================

/** Minimal KV surface we need (Cloudflare KVNamespace + test mocks). */
export interface AbuseKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AbuseEnv {
  MCP_ABUSE?: AbuseKv;
  PUBLIC_RATE_LIMIT_PER_MIN?: string;
  DATA_RATE_LIMIT_PER_MIN?: string;
  DATA_RATE_LIMIT_PER_DAY?: string;
  DATA_GLOBAL_LIMIT_PER_DAY?: string;
}

export interface AbuseCheckResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
  /** Which bucket rejected the call, when allowed=false. */
  reason?: "coarse_ip_minute" | "data_ip_minute" | "data_ip_day" | "data_global_day" | "kv_unavailable";
}

const DEFAULT_COARSE_PER_MIN = 60;
const DEFAULT_DATA_PER_MIN = 8;
const DEFAULT_DATA_PER_DAY = 40;
const DEFAULT_DATA_GLOBAL_PER_DAY = 10_000;

const MINUTE_TTL_SEC = 120;
const DAY_TTL_SEC = 172_800; // 2 days

function parseLimit(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function floorMinute(nowMs: number): number {
  return Math.floor(nowMs / 60_000);
}

function utcDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function secondsUntilNextMinute(nowMs: number): number {
  return Math.max(1, Math.ceil((60_000 - (nowMs % 60_000)) / 1000));
}

function secondsUntilUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

/**
 * Atomically-ish increment a KV counter. KV is eventually consistent; races can
 * overshoot slightly. Acceptable for abuse guards.
 */
export async function incrementKvCounter(
  kv: AbuseKv,
  key: string,
  expirationTtl: number,
): Promise<number> {
  const raw = await kv.get(key);
  const prev = raw ? Number.parseInt(raw, 10) : 0;
  const next = (Number.isFinite(prev) ? prev : 0) + 1;
  await kv.put(key, String(next), { expirationTtl });
  return next;
}

/** In-memory L1 soft prefilter (per-isolate). Never throws; fails open. */
interface MemWindow {
  count: number;
  resetAt: number;
}
const memBuckets = new Map<string, MemWindow>();
const MEM_WINDOW_MS = 60_000;

export function checkMemoryRateLimit(
  key: string,
  limitPerMinute: number,
  now: number = Date.now(),
): AbuseCheckResult {
  if (!Number.isFinite(limitPerMinute) || limitPerMinute <= 0) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetInSeconds: 0 };
  }
  let win = memBuckets.get(key);
  if (!win || now >= win.resetAt) {
    win = { count: 0, resetAt: now + MEM_WINDOW_MS };
    memBuckets.set(key, win);
  }
  win.count += 1;
  if (memBuckets.size > 10_000) {
    for (const [k, v] of memBuckets) {
      if (now >= v.resetAt) memBuckets.delete(k);
    }
  }
  const remaining = Math.max(0, limitPerMinute - win.count);
  const resetInSeconds = Math.ceil((win.resetAt - now) / 1000);
  return {
    allowed: win.count <= limitPerMinute,
    remaining,
    resetInSeconds,
    reason: win.count <= limitPerMinute ? undefined : "coarse_ip_minute",
  };
}

/** @deprecated Prefer checkCoarseLimit. Kept for older call sites / tests. */
export function checkRateLimit(
  key: string,
  limitPerMinute: number,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; resetInSeconds: number } {
  return checkMemoryRateLimit(key, limitPerMinute, now);
}

export function __resetRateLimitForTests(): void {
  memBuckets.clear();
}

/**
 * Coarse per-IP / minute limit for all POST /mcp.
 * Fail open when KV is missing or errors — fee tools should keep working.
 */
export async function checkCoarseLimit(
  env: AbuseEnv,
  ip: string,
  nowMs: number = Date.now(),
): Promise<AbuseCheckResult> {
  const limit = parseLimit(env.PUBLIC_RATE_LIMIT_PER_MIN, DEFAULT_COARSE_PER_MIN);

  // L1 soft prefilter (cheap, isolate-local).
  const mem = checkMemoryRateLimit(`coarse:${ip}`, limit, nowMs);
  if (!mem.allowed) return mem;

  const kv = env.MCP_ABUSE;
  if (!kv) {
    return { allowed: true, remaining: mem.remaining, resetInSeconds: mem.resetInSeconds };
  }

  try {
    const key = `rl:ip:${ip}:m:${floorMinute(nowMs)}`;
    const count = await incrementKvCounter(kv, key, MINUTE_TTL_SEC);
    const remaining = Math.max(0, limit - count);
    const resetInSeconds = secondsUntilNextMinute(nowMs);
    if (count > limit) {
      return { allowed: false, remaining: 0, resetInSeconds, reason: "coarse_ip_minute" };
    }
    return { allowed: true, remaining, resetInSeconds };
  } catch {
    // Fail open for coarse limit.
    return { allowed: true, remaining: mem.remaining, resetInSeconds: mem.resetInSeconds };
  }
}

/**
 * Data-tool budgets (Anthropic / comps path). Fail CLOSED if KV unavailable.
 */
export async function checkDataToolBudget(
  env: AbuseEnv,
  ip: string,
  nowMs: number = Date.now(),
): Promise<AbuseCheckResult> {
  const perMin = parseLimit(env.DATA_RATE_LIMIT_PER_MIN, DEFAULT_DATA_PER_MIN);
  const perDay = parseLimit(env.DATA_RATE_LIMIT_PER_DAY, DEFAULT_DATA_PER_DAY);
  const globalDay = parseLimit(env.DATA_GLOBAL_LIMIT_PER_DAY, DEFAULT_DATA_GLOBAL_PER_DAY);

  const kv = env.MCP_ABUSE;
  if (!kv) {
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: 60,
      reason: "kv_unavailable",
    };
  }

  try {
    const day = utcDayKey(nowMs);
    const min = floorMinute(nowMs);

    const ipMinKey = `rl:ip:${ip}:dm:${min}:data`;
    const ipDayKey = `rl:ip:${ip}:d:${day}:data`;
    const globalKey = `rl:global:d:${day}:data`;

    // Check-then-increment: read first to avoid burning budget on a reject path
    // when already over. Still race-prone under concurrency; acceptable.
    const [ipMinRaw, ipDayRaw, globalRaw] = await Promise.all([
      kv.get(ipMinKey),
      kv.get(ipDayKey),
      kv.get(globalKey),
    ]);
    const ipMinCount = Number.parseInt(ipMinRaw ?? "0", 10) || 0;
    const ipDayCount = Number.parseInt(ipDayRaw ?? "0", 10) || 0;
    const globalCount = Number.parseInt(globalRaw ?? "0", 10) || 0;

    if (ipMinCount >= perMin) {
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: secondsUntilNextMinute(nowMs),
        reason: "data_ip_minute",
      };
    }
    if (ipDayCount >= perDay) {
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: secondsUntilUtcMidnight(nowMs),
        reason: "data_ip_day",
      };
    }
    if (globalCount >= globalDay) {
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: secondsUntilUtcMidnight(nowMs),
        reason: "data_global_day",
      };
    }

    const [nextMin, nextDay, nextGlobal] = await Promise.all([
      incrementKvCounter(kv, ipMinKey, MINUTE_TTL_SEC),
      incrementKvCounter(kv, ipDayKey, DAY_TTL_SEC),
      incrementKvCounter(kv, globalKey, DAY_TTL_SEC),
    ]);

    // Re-check after increment in case of race overshoot.
    if (nextMin > perMin) {
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: secondsUntilNextMinute(nowMs),
        reason: "data_ip_minute",
      };
    }
    if (nextDay > perDay) {
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: secondsUntilUtcMidnight(nowMs),
        reason: "data_ip_day",
      };
    }
    if (nextGlobal > globalDay) {
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: secondsUntilUtcMidnight(nowMs),
        reason: "data_global_day",
      };
    }

    const remaining = Math.min(perMin - nextMin, perDay - nextDay, globalDay - nextGlobal);
    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      resetInSeconds: secondsUntilNextMinute(nowMs),
    };
  } catch {
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: 60,
      reason: "kv_unavailable",
    };
  }
}
