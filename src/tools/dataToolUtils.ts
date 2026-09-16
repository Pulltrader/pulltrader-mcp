// Shared helpers for the data-backed Scout tools (backend bridge).

import { toolError, type ToolError } from "../errors";
import type { BackendErrorCode } from "../backend/client";

/** Map a backend client failure to a stable MCP tool error. */
export function mapBackendError(code: BackendErrorCode, message: string): ToolError {
  switch (code) {
    case "NOT_CONFIGURED":
      return toolError("DATA_BACKEND_UNAVAILABLE", "This Scout server is not configured to return live card or athlete data.");
    case "TIMEOUT":
      return toolError("UPSTREAM_TIMEOUT", "The Scout data service took too long to respond. Please try again.");
    case "RATE_LIMITED":
      return toolError("RATE_LIMITED", "The Scout data service is rate limiting requests. Please retry shortly.");
    case "NOT_FOUND":
      return toolError("NOT_FOUND", message || "No matching record was found.");
    case "UPSTREAM_ERROR":
    default:
      return toolError("UPSTREAM_ERROR", "The Scout data service is temporarily unavailable.");
  }
}

const SHARED_PROPS = {
  query: {
    type: "string",
    minLength: 2,
    description:
      "Natural-language card description, e.g. '2023 Panini Prizm Victor Wembanyama #136 Silver PSA 10'. Either query or item is required.",
  },
  item: {
    type: "object",
    additionalProperties: true,
    description:
      "Structured card fields (alternative to query): player_athlete, year_manufactured, set_name, card_number, parallel_variety, grader, grade, sport.",
  },
} as const;

export const CARD_QUERY_SCHEMA = SHARED_PROPS;

export function money(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `$${n.toFixed(2)}` : "n/a";
}
