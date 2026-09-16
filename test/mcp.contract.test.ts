import { describe, it, expect } from "vitest";
import { handleMcpMessage, type McpContext } from "../src/mcp";
import { TOOL_NAME } from "../src/tools/compareSellingCosts";
import { DATA_TOOL_NAMES, isDataTool } from "../src/tools/registry";
import type { BackendConfig } from "../src/backend/client";

function call(method: string, params?: unknown, id: string | number | null = 1, ctx: McpContext = {}) {
  return handleMcpMessage(
    { jsonrpc: "2.0", id, method, params },
    { now: new Date("2026-06-27T12:00:00Z"), ...ctx },
  );
}

// A stub backend whose fetch returns a canned JSON body, so data-backed tools
// can be exercised through the full dispatch path without network.
function stubBackend(body: unknown, status = 200): BackendConfig {
  return {
    baseUrl: "https://backend.test",
    secret: "test-secret",
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
  };
}

describe("MCP: initialize", () => {
  it("echoes the client protocol version and advertises tools", async () => {
    const { response } = await call("initialize", { protocolVersion: "2025-06-18" });
    const result = response!.result as any;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("pulltrader-mcp");
  });
  it("falls back to a default protocol version", async () => {
    const { response } = await call("initialize", {});
    expect((response!.result as any).protocolVersion).toBeTruthy();
  });
});

describe("MCP: notifications", () => {
  it("returns no response for notifications/initialized", async () => {
    const out = await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(out.response).toBeNull();
  });
});

describe("MCP: cost tiers", () => {
  it("marks card tools as data-tier for abuse budgets", () => {
    expect([...DATA_TOOL_NAMES].sort()).toEqual([
      "get_card_price_history",
      "identify_card",
      "search_card_sales",
      "summarize_card_market",
    ]);
    expect(isDataTool("compare_selling_costs")).toBe(false);
    expect(isDataTool("identify_card")).toBe(true);
  });
});

describe("MCP: tools/list", () => {
  it("advertises the full Scout tool set", async () => {
    const { response } = await call("tools/list");
    const tools = (response!.result as any).tools;
    const names = tools.map((t: any) => t.name);
    expect(names).toEqual([
      "compare_selling_costs",
      "calculate_required_sale_price",
      "explain_selling_method",
      "identify_card",
      "search_card_sales",
      "summarize_card_market",
      "get_card_price_history",
    ]);
    const compare = tools.find((t: any) => t.name === TOOL_NAME);
    expect(compare.inputSchema.required).toContain("sale_price");
    expect(compare.description.toLowerCase()).toContain("do not use");
    const required = tools.find((t: any) => t.name === "calculate_required_sale_price");
    expect(required.inputSchema.required).toContain("target_net");
    const identify = tools.find((t: any) => t.name === "identify_card");
    expect(identify.inputSchema.required).toContain("query");
  });
});

describe("MCP: tools/call", () => {
  it("returns structured + text content on success", async () => {
    const { response, toolCall } = await call("tools/call", { name: TOOL_NAME, arguments: { sale_price: 100 } });
    const result = response!.result as any;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe("text");
    expect(result.structuredContent.methods.length).toBeGreaterThan(0);
    expect(toolCall).toEqual({ name: TOOL_NAME, ok: true });
  });
  it("returns an isError tool result (not a JSON-RPC error) on invalid input", async () => {
    const { response, toolCall } = await call("tools/call", { name: TOOL_NAME, arguments: { sale_price: -5 } });
    const result = response!.result as any;
    expect(response!.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("INVALID_INPUT");
    expect(toolCall?.ok).toBe(false);
  });
  it("dispatches calculate_required_sale_price", async () => {
    const { response, toolCall } = await call("tools/call", {
      name: "calculate_required_sale_price",
      arguments: { target_net: 80, method: "pulltrader_storefront" },
    });
    const result = response!.result as any;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.required_sale_price).toBeGreaterThan(0);
    expect(toolCall).toEqual({ name: "calculate_required_sale_price", ok: true });
  });
  it("dispatches explain_selling_method", async () => {
    const { response, toolCall } = await call("tools/call", {
      name: "explain_selling_method",
      arguments: { methods: ["pulltrader_marketplace"] },
    });
    const result = response!.result as any;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.methods).toHaveLength(1);
    expect(result.structuredContent.methods[0].method).toBe("pulltrader_marketplace");
    expect(toolCall).toEqual({ name: "explain_selling_method", ok: true });
  });
  it("data tool returns DATA_BACKEND_UNAVAILABLE when no backend is configured", async () => {
    const { response, toolCall } = await call("tools/call", {
      name: "identify_card",
      arguments: { query: "2018 Prizm Luka Doncic Silver PSA 10" },
    });
    const result = response!.result as any;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("DATA_BACKEND_UNAVAILABLE");
    expect(toolCall).toEqual({ name: "identify_card", ok: false, errorCode: "DATA_BACKEND_UNAVAILABLE" });
  });
  it("dispatches identify_card through a configured backend", async () => {
    const backend = stubBackend({
      query: "2018 Prizm Luka Doncic Silver PSA 10",
      category: "basketball",
      identity: {
        player_athlete: "Luka Doncic",
        year: "2018",
        set_name: "Prizm",
        card_number: null,
        parallel: "Silver",
        grader: "PSA",
        grade: "10",
        sport: "basketball",
      },
      fields_extracted: 6,
      confidence: "high",
    });
    const { response, toolCall } = await call(
      "tools/call",
      { name: "identify_card", arguments: { query: "2018 Prizm Luka Doncic Silver PSA 10" } },
      1,
      { backend },
    );
    const result = response!.result as any;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.identity.player_athlete).toBe("Luka Doncic");
    expect(toolCall).toEqual({ name: "identify_card", ok: true });
  });
  it("returns a JSON-RPC method-not-found for an unknown tool", async () => {
    const { response } = await call("tools/call", { name: "do_everything", arguments: {} });
    expect(response!.error?.code).toBe(-32601);
  });
  it("requires a string tool name", async () => {
    const { response } = await call("tools/call", { arguments: {} });
    expect(response!.error?.code).toBe(-32602);
  });
});

describe("MCP: protocol errors", () => {
  it("ping returns an empty result", async () => {
    const { response } = await call("ping");
    expect(response!.result).toEqual({});
  });
  it("unknown method returns -32601", async () => {
    const { response } = await call("does/not/exist");
    expect(response!.error?.code).toBe(-32601);
  });
  it("malformed request returns -32600", async () => {
    const out = await handleMcpMessage({ foo: "bar" });
    expect(out.response!.error?.code).toBe(-32600);
  });
});
