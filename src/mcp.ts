// =============================================================================
// MCP JSON-RPC HANDLER (transport-agnostic, pure)
// =============================================================================
// Takes a parsed JSON-RPC message and returns the response object (or null for
// notifications). The Worker fetch handler wraps this with Streamable HTTP.
// =============================================================================

import { DEFAULT_PROTOCOL_VERSION, REGISTRY_NAME, SERVER_NAME, SERVER_VERSION } from "./version";
import { TOOL_DEFINITIONS, getTool } from "./tools/registry";
import type { BackendConfig } from "./backend/client";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpContext {
  now?: Date;
  relatedUrl?: string;
  /** Backend bridge config for data-backed tools. Absent on pure-only servers. */
  backend?: BackendConfig;
}

export interface McpOutcome {
  /** Response to send, or null when the input was a notification/response. */
  response: JsonRpcResponse | null;
  /** Set when a tool was invoked, for analytics. */
  toolCall?: { name: string; ok: boolean; errorCode?: string };
}

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data !== undefined ? { code, message, data } : { code, message } };
}

function isRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (msg as { method?: unknown }).method === "string"
  );
}

/** Handle one parsed JSON-RPC message. */
export async function handleMcpMessage(msg: unknown, ctx: McpContext = {}): Promise<McpOutcome> {
  if (!isRequest(msg)) {
    return { response: err(null, JSONRPC_INVALID_REQUEST, "Invalid JSON-RPC 2.0 request.") };
  }

  const id = msg.id ?? null;
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize": {
      const params = (msg.params ?? {}) as { protocolVersion?: unknown };
      const protocolVersion =
        typeof params.protocolVersion === "string" ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION;
      return {
        response: ok(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: "Scout by Pulltrader", version: SERVER_VERSION },
          instructions:
            "Scout's trading-card intelligence tools. Card research: identify_card resolves a text description into structured fields; search_card_sales returns recent comparable sold sales; summarize_card_market gives median/percentile/volatility market value; get_card_price_history returns a price-over-time series. Seller economics: compare_selling_costs estimates what a seller keeps across eBay and Pulltrader methods; calculate_required_sale_price solves for the price to hit a target net; explain_selling_method describes how each method charges fees. All market figures are estimates from recent sales (excluding fees/taxes/shipping) and are not financial advice; never claim guaranteed value or one platform as universally cheapest. Trading cards only.",
        }),
      };
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      // Notifications get no response.
      return { response: null };

    case "ping":
      return { response: ok(id, {}) };

    case "tools/list":
      return { response: ok(id, { tools: TOOL_DEFINITIONS }) };

    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== "string") {
        return { response: err(id, JSONRPC_INVALID_PARAMS, "tools/call requires a string 'name'.") };
      }
      const tool = getTool(params.name);
      if (!tool) {
        return { response: err(id, JSONRPC_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`) };
      }
      try {
        const outcome = await tool.run(params.arguments, {
          now: ctx.now,
          relatedUrl: ctx.relatedUrl,
          backend: ctx.backend,
        });
        if (!outcome.ok) {
          // Tool-level (input) error -> isError result, not a JSON-RPC error.
          return {
            response: ok(id, {
              isError: true,
              content: [{ type: "text", text: `Error [${outcome.error.code}]: ${outcome.error.message}` }],
              structuredContent: { error: outcome.error },
            }),
            toolCall: { name: tool.name, ok: false, errorCode: outcome.error.code },
          };
        }
        return {
          response: ok(id, {
            content: [{ type: "text", text: outcome.text }],
            structuredContent: outcome.structured,
          }),
          toolCall: { name: tool.name, ok: true },
        };
      } catch {
        return {
          response: ok(id, {
            isError: true,
            content: [{ type: "text", text: "Error [INTERNAL_ERROR]: the tool failed to compute a result." }],
            structuredContent: { error: { code: "INTERNAL_ERROR", message: "The tool failed to compute a result." } },
          }),
          toolCall: { name: tool.name, ok: false, errorCode: "INTERNAL_ERROR" },
        };
      }
    }

    default:
      if (isNotification) return { response: null };
      return { response: err(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${msg.method}`) };
  }
}

export { JSONRPC_PARSE_ERROR, JSONRPC_INVALID_REQUEST, JSONRPC_INTERNAL_ERROR };
