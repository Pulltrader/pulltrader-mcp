import { describe, it, expect, beforeEach } from "vitest";
import {
  checkCoarseLimit,
  checkDataToolBudget,
  checkMemoryRateLimit,
  incrementKvCounter,
  __resetRateLimitForTests,
  type AbuseKv,
  type AbuseEnv,
} from "../src/abuseGuard";

class MemoryKv implements AbuseKv {
  store = new Map<string, string>();
  failNext = false;

  async get(key: string): Promise<string | null> {
    if (this.failNext) throw new Error("kv down");
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failNext) throw new Error("kv down");
    this.store.set(key, value);
  }
}

describe("incrementKvCounter", () => {
  it("increments from empty", async () => {
    const kv = new MemoryKv();
    expect(await incrementKvCounter(kv, "k", 60)).toBe(1);
    expect(await incrementKvCounter(kv, "k", 60)).toBe(2);
  });
});

describe("checkMemoryRateLimit", () => {
  beforeEach(() => __resetRateLimitForTests());

  it("allows under the limit and blocks over", () => {
    const now = 1_700_000_000_000;
    expect(checkMemoryRateLimit("a", 2, now).allowed).toBe(true);
    expect(checkMemoryRateLimit("a", 2, now).allowed).toBe(true);
    expect(checkMemoryRateLimit("a", 2, now).allowed).toBe(false);
  });
});

describe("checkCoarseLimit", () => {
  beforeEach(() => __resetRateLimitForTests());

  it("fails open when KV is missing", async () => {
    const env: AbuseEnv = { PUBLIC_RATE_LIMIT_PER_MIN: "60" };
    const r = await checkCoarseLimit(env, "1.2.3.4");
    expect(r.allowed).toBe(true);
  });

  it("enforces the KV per-IP minute limit", async () => {
    const kv = new MemoryKv();
    const env: AbuseEnv = { MCP_ABUSE: kv, PUBLIC_RATE_LIMIT_PER_MIN: "3" };
    const now = Date.UTC(2026, 6, 25, 12, 0, 0);
    expect((await checkCoarseLimit(env, "9.9.9.9", now)).allowed).toBe(true);
    expect((await checkCoarseLimit(env, "9.9.9.9", now)).allowed).toBe(true);
    expect((await checkCoarseLimit(env, "9.9.9.9", now)).allowed).toBe(true);
    const blocked = await checkCoarseLimit(env, "9.9.9.9", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("coarse_ip_minute");
  });

  it("fails open when KV throws", async () => {
    const kv = new MemoryKv();
    kv.failNext = true;
    const env: AbuseEnv = { MCP_ABUSE: kv, PUBLIC_RATE_LIMIT_PER_MIN: "1" };
    const r = await checkCoarseLimit(env, "1.1.1.1");
    expect(r.allowed).toBe(true);
  });
});

describe("checkDataToolBudget", () => {
  beforeEach(() => __resetRateLimitForTests());

  it("fails closed when KV is missing", async () => {
    const r = await checkDataToolBudget({}, "1.2.3.4");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("kv_unavailable");
  });

  it("fails closed when KV throws", async () => {
    const kv = new MemoryKv();
    kv.failNext = true;
    const r = await checkDataToolBudget({ MCP_ABUSE: kv }, "1.2.3.4");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("kv_unavailable");
  });

  it("enforces per-IP per-minute data budget", async () => {
    const kv = new MemoryKv();
    const env: AbuseEnv = {
      MCP_ABUSE: kv,
      DATA_RATE_LIMIT_PER_MIN: "2",
      DATA_RATE_LIMIT_PER_DAY: "100",
      DATA_GLOBAL_LIMIT_PER_DAY: "1000",
    };
    const now = Date.UTC(2026, 6, 25, 12, 0, 0);
    expect((await checkDataToolBudget(env, "8.8.8.8", now)).allowed).toBe(true);
    expect((await checkDataToolBudget(env, "8.8.8.8", now)).allowed).toBe(true);
    const blocked = await checkDataToolBudget(env, "8.8.8.8", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("data_ip_minute");
  });

  it("enforces per-IP daily data budget", async () => {
    const kv = new MemoryKv();
    const env: AbuseEnv = {
      MCP_ABUSE: kv,
      DATA_RATE_LIMIT_PER_MIN: "100",
      DATA_RATE_LIMIT_PER_DAY: "2",
      DATA_GLOBAL_LIMIT_PER_DAY: "1000",
    };
    const now = Date.UTC(2026, 6, 25, 12, 0, 0);
    expect((await checkDataToolBudget(env, "8.8.8.8", now)).allowed).toBe(true);
    expect((await checkDataToolBudget(env, "8.8.8.8", now)).allowed).toBe(true);
    const blocked = await checkDataToolBudget(env, "8.8.8.8", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("data_ip_day");
  });

  it("enforces global daily circuit breaker", async () => {
    const kv = new MemoryKv();
    const env: AbuseEnv = {
      MCP_ABUSE: kv,
      DATA_RATE_LIMIT_PER_MIN: "100",
      DATA_RATE_LIMIT_PER_DAY: "100",
      DATA_GLOBAL_LIMIT_PER_DAY: "2",
    };
    const now = Date.UTC(2026, 6, 25, 12, 0, 0);
    expect((await checkDataToolBudget(env, "1.1.1.1", now)).allowed).toBe(true);
    expect((await checkDataToolBudget(env, "2.2.2.2", now)).allowed).toBe(true);
    const blocked = await checkDataToolBudget(env, "3.3.3.3", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("data_global_day");
  });
});
