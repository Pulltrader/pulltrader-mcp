import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index";
import { __resetRateLimitForTests, type AbuseKv } from "../src/abuseGuard";

class MemoryKv implements AbuseKv {
  store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function mockCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function mcpPost(body: unknown, env: Record<string, unknown>, ip = "203.0.113.10") {
  const req = new Request("https://mcp.pulltrader.app/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
  return worker.fetch(req, env as any, mockCtx());
}

describe("Worker abuse budgets (HTTP)", () => {
  beforeEach(() => __resetRateLimitForTests());

  it("returns tool isError RATE_LIMITED when data budget is exhausted", async () => {
    const kv = new MemoryKv();
    const env = {
      MCP_ABUSE: kv,
      PUBLIC_RATE_LIMIT_PER_MIN: "60",
      DATA_RATE_LIMIT_PER_MIN: "1",
      DATA_RATE_LIMIT_PER_DAY: "100",
      DATA_GLOBAL_LIMIT_PER_DAY: "1000",
      DISABLE_ANALYTICS: "1",
    };

    const first = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "identify_card", arguments: { query: "2018 Prizm Luka" } },
      },
      env,
    );
    // First call is allowed through the budget check; without backend it may
    // still error as DATA_BACKEND_UNAVAILABLE — that is fine. Second must be RATE_LIMITED.
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as any;
    expect(firstBody.result?.isError).toBe(true);

    const second = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "identify_card", arguments: { query: "2018 Prizm Luka" } },
      },
      env,
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe("RATE_LIMITED");
  });

  it("fails closed on data tools when KV binding is missing", async () => {
    const env = {
      PUBLIC_RATE_LIMIT_PER_MIN: "60",
      DISABLE_ANALYTICS: "1",
    };
    const res = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_card_sales", arguments: { query: "Charizard" } },
      },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe("RATE_LIMITED");
  });

  it("still allows pure fee tools without KV", async () => {
    const env = {
      PUBLIC_RATE_LIMIT_PER_MIN: "60",
      DISABLE_ANALYTICS: "1",
    };
    const res = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "compare_selling_costs", arguments: { sale_price: 100 } },
      },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.methods.length).toBeGreaterThan(0);
  });

  it("rejects oversized batches", async () => {
    const kv = new MemoryKv();
    const env = { MCP_ABUSE: kv, DISABLE_ANALYTICS: "1" };
    const batch = Array.from({ length: 6 }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "ping",
    }));
    const res = await mcpPost(batch, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32600);
  });
});
