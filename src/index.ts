// =============================================================================
// Pulltrader Seller Economics MCP — Cloudflare Worker entry point
// =============================================================================
// Public, read-only MCP server using the Streamable HTTP transport at /mcp.
// Business logic lives in src/fees and src/tools; this file is the thin
// transport + operational layer (routing, CORS, rate limit, health, analytics).
// =============================================================================

import { handleMcpMessage, type JsonRpcResponse } from "./mcp";
import { checkRateLimit } from "./rateLimit";
import { anonymousId, capture, type AnalyticsEnv } from "./analytics";
import { REGISTRY_NAME, SERVER_NAME, SERVER_VERSION, DEFAULT_PROTOCOL_VERSION } from "./version";
import { EBAY_FEES, PULLTRADER_FEES } from "./fees/schedule";

interface Env extends AnalyticsEnv {
  PULLTRADER_RELATED_URL?: string;
  PUBLIC_RATE_LIMIT_PER_MIN?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

function rpcError(id: null, code: number, message: string, status: number): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  return json(body, status);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // --- Health & version (operational, unauthenticated) ---
    if (path === "/health" && request.method === "GET") {
      return json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
    }
    if ((path === "/version" || path === "/") && request.method === "GET") {
      return json({
        name: REGISTRY_NAME,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        transport: "streamable-http",
        endpoint: "/mcp",
        fee_schedules: {
          ebay: { version: EBAY_FEES.version, effective_date: EBAY_FEES.effective_date, estimated: true },
          pulltrader: { version: PULLTRADER_FEES.version, effective_date: PULLTRADER_FEES.effective_date, estimated: false },
        },
        documentation: "https://pulltrader.app/mcp",
      });
    }

    if (path !== "/mcp") {
      return json({ error: "Not found", message: "MCP endpoint is at /mcp" }, 404);
    }

    // Streamable HTTP: this server does not offer a server-initiated SSE stream.
    if (request.method === "GET") {
      return json({ error: "Method not allowed", message: "Use HTTP POST for JSON-RPC at /mcp." }, 405, {
        Allow: "POST, OPTIONS",
      });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" });
    }

    // --- Rate limit (best-effort) ---
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const limit = Number.parseInt(env.PUBLIC_RATE_LIMIT_PER_MIN ?? "60", 10);
    const rl = checkRateLimit(ip, Number.isFinite(limit) ? limit : 60);
    if (!rl.allowed) {
      return json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "Rate limited. Please retry shortly.", data: { code: "RATE_LIMITED" } },
        },
        429,
        { "Retry-After": String(rl.resetInSeconds) },
      );
    }

    // --- Parse body ---
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return rpcError(null, -32700, "Parse error: request body is not valid JSON.", 400);
    }

    const relatedUrl = env.PULLTRADER_RELATED_URL ?? "https://pulltrader.app/sell";
    const anonId = await anonymousId(`${ip}:${request.headers.get("User-Agent") ?? ""}`);
    const started = Date.now();

    // Batch or single message.
    const messages = Array.isArray(payload) ? payload : [payload];
    if (messages.length === 0) {
      return rpcError(null, -32600, "Invalid Request: empty batch.", 400);
    }

    const responses: JsonRpcResponse[] = [];
    for (const message of messages) {
      const outcome = handleMcpMessage(message, { relatedUrl });
      if (outcome.response) responses.push(outcome.response);
      if (outcome.toolCall) {
        ctx.waitUntil(
          capture(
            env,
            {
              event: "mcp_tool_call",
              tool: outcome.toolCall.name,
              ok: outcome.toolCall.ok,
              errorCode: outcome.toolCall.errorCode,
              latencyMs: Date.now() - started,
            },
            anonId,
          ),
        );
      }
    }

    // All notifications/responses -> 202 Accepted, no body (per Streamable HTTP).
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }

    const body = Array.isArray(payload) ? responses : responses[0];
    return json(body);
  },
};
