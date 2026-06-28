import { describe, it, expect } from "vitest";
import { handleMcpMessage } from "../src/mcp";
import { TOOL_NAME } from "../src/tools/compareSellingCosts";

function call(method: string, params?: unknown, id: string | number | null = 1) {
  return handleMcpMessage({ jsonrpc: "2.0", id, method, params }, { now: new Date("2026-06-27T12:00:00Z") });
}

describe("MCP: initialize", () => {
  it("echoes the client protocol version and advertises tools", () => {
    const { response } = call("initialize", { protocolVersion: "2025-06-18" });
    const result = response!.result as any;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("pulltrader-mcp");
  });
  it("falls back to a default protocol version", () => {
    const { response } = call("initialize", {});
    expect((response!.result as any).protocolVersion).toBeTruthy();
  });
});

describe("MCP: notifications", () => {
  it("returns no response for notifications/initialized", () => {
    const out = handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(out.response).toBeNull();
  });
});

describe("MCP: tools/list", () => {
  it("returns the single tool with a required sale_price", () => {
    const { response } = call("tools/list");
    const tools = (response!.result as any).tools;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe(TOOL_NAME);
    expect(tools[0].inputSchema.required).toContain("sale_price");
    expect(tools[0].description.toLowerCase()).toContain("do not use");
  });
});

describe("MCP: tools/call", () => {
  it("returns structured + text content on success", () => {
    const { response, toolCall } = call("tools/call", { name: TOOL_NAME, arguments: { sale_price: 100 } });
    const result = response!.result as any;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe("text");
    expect(result.structuredContent.methods.length).toBeGreaterThan(0);
    expect(toolCall).toEqual({ name: TOOL_NAME, ok: true });
  });
  it("returns an isError tool result (not a JSON-RPC error) on invalid input", () => {
    const { response, toolCall } = call("tools/call", { name: TOOL_NAME, arguments: { sale_price: -5 } });
    const result = response!.result as any;
    expect(response!.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("INVALID_INPUT");
    expect(toolCall?.ok).toBe(false);
  });
  it("returns a JSON-RPC method-not-found for an unknown tool", () => {
    const { response } = call("tools/call", { name: "do_everything", arguments: {} });
    expect(response!.error?.code).toBe(-32601);
  });
  it("requires a string tool name", () => {
    const { response } = call("tools/call", { arguments: {} });
    expect(response!.error?.code).toBe(-32602);
  });
});

describe("MCP: protocol errors", () => {
  it("ping returns an empty result", () => {
    const { response } = call("ping");
    expect(response!.result).toEqual({});
  });
  it("unknown method returns -32601", () => {
    const { response } = call("does/not/exist");
    expect(response!.error?.code).toBe(-32601);
  });
  it("malformed request returns -32600", () => {
    const out = handleMcpMessage({ foo: "bar" });
    expect(out.response!.error?.code).toBe(-32600);
  });
});
