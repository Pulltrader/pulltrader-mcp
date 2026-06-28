// =============================================================================
// MCP JSON-RPC HANDLER (transport-agnostic, pure)
// =============================================================================
// Takes a parsed JSON-RPC message and returns the response object (or null for
// notifications). The Worker fetch handler wraps this with Streamable HTTP.
// =============================================================================

import { DEFAULT_PROTOCOL_VERSION, REGISTRY_NAME, SERVER_NAME, SERVER_VERSION } from "./version";
import {
  TOOL_DEFINITION,
  TOOL_NAME,
  compareSellingCosts,
  summarizeComparison,
} from "./tools/compareSellingCosts";

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
export function handleMcpMessage(msg: unknown, ctx: McpContext = {}): McpOutcome {
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
          serverInfo: { name: SERVER_NAME, title: "Pulltrader Seller Economics", version: SERVER_VERSION },
          instructions:
            "Use compare_selling_costs to estimate what a trading-card seller keeps across eBay and Pulltrader selling methods. Always present eBay figures as estimates and preserve the stated assumptions.",
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
      return { response: ok(id, { tools: [TOOL_DEFINITION] }) };

    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== "string") {
        return { response: err(id, JSONRPC_INVALID_PARAMS, "tools/call requires a string 'name'.") };
      }
      if (params.name !== TOOL_NAME) {
        return { response: err(id, JSONRPC_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`) };
      }
      try {
        const outcome = compareSellingCosts(params.arguments, { now: ctx.now, relatedUrl: ctx.relatedUrl });
        if (!outcome.ok) {
          // Tool-level (input) error -> isError result, not a JSON-RPC error.
          return {
            response: ok(id, {
              isError: true,
              content: [{ type: "text", text: `Error [${outcome.error.code}]: ${outcome.error.message}` }],
              structuredContent: { error: outcome.error },
            }),
            toolCall: { name: TOOL_NAME, ok: false, errorCode: outcome.error.code },
          };
        }
        return {
          response: ok(id, {
            content: [{ type: "text", text: summarizeComparison(outcome.result) }],
            structuredContent: outcome.result,
          }),
          toolCall: { name: TOOL_NAME, ok: true },
        };
      } catch {
        return {
          response: ok(id, {
            isError: true,
            content: [{ type: "text", text: "Error [INTERNAL_ERROR]: failed to compute the comparison." }],
            structuredContent: { error: { code: "INTERNAL_ERROR", message: "Failed to compute the comparison." } },
          }),
          toolCall: { name: TOOL_NAME, ok: false, errorCode: "INTERNAL_ERROR" },
        };
      }
    }

    default:
      if (isNotification) return { response: null };
      return { response: err(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${msg.method}`) };
  }
}

export { JSONRPC_PARSE_ERROR, JSONRPC_INVALID_REQUEST, JSONRPC_INTERNAL_ERROR };
