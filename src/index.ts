// =============================================================================
// Pulltrader Seller Economics MCP — Cloudflare Worker entry point
// =============================================================================
// Public, read-only MCP server using the Streamable HTTP transport at /mcp.
// Business logic lives in src/fees and src/tools; this file is the thin
// transport + operational layer (routing, CORS, abuse budgets, health, analytics).
// =============================================================================

import { handleMcpMessage, type JsonRpcResponse } from "./mcp";
import { checkCoarseLimit, checkDataToolBudget, type AbuseKv } from "./abuseGuard";
import { anonymousId, capture, type AnalyticsEnv } from "./analytics";
import { REGISTRY_NAME, SERVER_NAME, SERVER_VERSION, DEFAULT_PROTOCOL_VERSION } from "./version";
import { EBAY_FEES, PULLTRADER_FEES } from "./fees/schedule";
import type { BackendConfig } from "./backend/client";
import { isDataTool } from "./tools/registry";

interface Env extends AnalyticsEnv {
  PULLTRADER_RELATED_URL?: string;
  PUBLIC_RATE_LIMIT_PER_MIN?: string;
  DATA_RATE_LIMIT_PER_MIN?: string;
  DATA_RATE_LIMIT_PER_DAY?: string;
  DATA_GLOBAL_LIMIT_PER_DAY?: string;
  /** KV namespace for global abuse / token-bill budgets. */
  MCP_ABUSE?: AbuseKv;
  /** Base URL of the Pulltrader backend MCP bridge, e.g. https://api.pulltrader.app */
  PULLTRADER_API_BASE?: string;
  /** Shared secret for the backend /api/mcp/* bridge (set via `wrangler secret`). */
  SCOUT_MCP_SECRET?: string;
  /** Optional per-request backend timeout in ms (default 12000). */
  SCOUT_BACKEND_TIMEOUT_MS?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** Cap batch size so one POST cannot amplify data-tool spend. */
const MAX_BATCH_SIZE = 5;

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

function toolNameFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as { method?: unknown; params?: unknown };
  if (m.method !== "tools/call") return null;
  const params = m.params as { name?: unknown } | undefined;
  return typeof params?.name === "string" ? params.name : null;
}

function rateLimitedToolResult(id: string | number | null, resetInSeconds: number): JsonRpcResponse {
  const error = {
    code: "RATE_LIMITED" as const,
    message: `Rate limited. Retry in about ${resetInSeconds}s.`,
  };
  return {
    jsonrpc: "2.0",
    id,
    result: {
      isError: true,
      content: [{ type: "text", text: `Error [RATE_LIMITED]: ${error.message}` }],
      structuredContent: { error },
    },
  };
}

function messageId(message: unknown): string | number | null {
  if (!message || typeof message !== "object") return null;
  const id = (message as { id?: unknown }).id;
  if (typeof id === "string" || typeof id === "number") return id;
  return null;
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

    // --- Coarse per-IP rate limit (KV global + in-memory L1; fails open) ---
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const coarse = await checkCoarseLimit(env, ip);
    if (!coarse.allowed) {
      return json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "Rate limited. Please retry shortly.", data: { code: "RATE_LIMITED" } },
        },
        429,
        { "Retry-After": String(coarse.resetInSeconds) },
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

    // Data-backed tools call the Pulltrader backend bridge. Only enabled when
    // both the base URL and the shared secret are configured; otherwise those
    // tools degrade to a DATA_BACKEND_UNAVAILABLE tool error.
    let backend: BackendConfig | undefined;
    if (env.PULLTRADER_API_BASE && env.SCOUT_MCP_SECRET) {
      const timeoutMs = Number.parseInt(env.SCOUT_BACKEND_TIMEOUT_MS ?? "", 10);
      backend = {
        baseUrl: env.PULLTRADER_API_BASE,
        secret: env.SCOUT_MCP_SECRET,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
        clientIp: ip,
      };
    }

    // Batch or single message.
    const messages = Array.isArray(payload) ? payload : [payload];
    if (messages.length === 0) {
      return rpcError(null, -32600, "Invalid Request: empty batch.", 400);
    }
    if (messages.length > MAX_BATCH_SIZE) {
      return rpcError(
        null,
        -32600,
        `Invalid Request: batch size ${messages.length} exceeds maximum of ${MAX_BATCH_SIZE}.`,
        400,
      );
    }

    const responses: JsonRpcResponse[] = [];
    for (const message of messages) {
      const toolName = toolNameFromMessage(message);
      if (toolName && isDataTool(toolName)) {
        const budget = await checkDataToolBudget(env, ip);
        if (!budget.allowed) {
          const id = messageId(message);
          // Notifications have no id — skip a body response.
          if (id !== null || (message && typeof message === "object" && "id" in (message as object))) {
            responses.push(rateLimitedToolResult(id, budget.resetInSeconds));
          }
          ctx.waitUntil(
            capture(
              env,
              {
                event: "mcp_tool_call",
                tool: toolName,
                ok: false,
                errorCode: "RATE_LIMITED",
                latencyMs: Date.now() - started,
              },
              anonId,
            ),
          );
          continue;
        }
      }

      const outcome = await handleMcpMessage(message, { relatedUrl, backend });
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
