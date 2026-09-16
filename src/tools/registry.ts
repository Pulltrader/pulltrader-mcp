// =============================================================================
// TOOL REGISTRY
// =============================================================================
// Single place that lists the Scout MCP tools and dispatches a tools/call to the
// right handler. Adding a tool = add one entry here. Each tool exposes its MCP
// definition and a `run` that returns a uniform outcome the JSON-RPC layer maps
// to content + structuredContent (or an isError tool result).
//
// Tools are either:
//   - pure (seller economics): synchronous, no I/O, computed locally.
//   - data-backed (cards/athletes): asynchronous, call the Scout backend bridge
//     via ctx.backend. `run` may therefore return a Promise.
// =============================================================================

import type { ToolError } from "../errors";
import type { BackendConfig } from "../backend/client";
import {
  TOOL_NAME as COMPARE_NAME,
  TOOL_DEFINITION as COMPARE_DEF,
  compareSellingCosts,
  summarizeComparison,
} from "./compareSellingCosts";
import {
  TOOL_NAME as REQUIRED_NAME,
  TOOL_DEFINITION as REQUIRED_DEF,
  calculateRequiredSalePrice,
  summarizeRequiredSalePrice,
} from "./calculateRequiredSalePrice";
import {
  TOOL_NAME as EXPLAIN_NAME,
  TOOL_DEFINITION as EXPLAIN_DEF,
  explainSellingMethod,
  summarizeExplain,
} from "./explainSellingMethod";
import * as identifyCard from "./identifyCard";
import * as searchCardSales from "./searchCardSales";
import * as summarizeCardMarket from "./summarizeCardMarket";
import * as getCardPriceHistory from "./getCardPriceHistory";

export interface ToolContext {
  now?: Date;
  relatedUrl?: string;
  /** Backend bridge config for data-backed tools. Absent on pure-only servers. */
  backend?: BackendConfig;
}

export type ToolRun =
  | { ok: true; text: string; structured: unknown }
  | { ok: false; error: ToolError };

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

/** Cost tier drives abuse budgets. `data` tools hit Anthropic / comps backends. */
export type CostTier = "pure" | "data";

export interface McpTool {
  name: string;
  definition: ToolDefinition;
  costTier: CostTier;
  run(args: unknown, ctx: ToolContext): ToolRun | Promise<ToolRun>;
}

export const TOOLS: McpTool[] = [
  // --- Pure seller-economics tools ---
  {
    name: COMPARE_NAME,
    definition: COMPARE_DEF,
    costTier: "pure",
    run(args, ctx) {
      const outcome = compareSellingCosts(args, ctx);
      return outcome.ok
        ? { ok: true, text: summarizeComparison(outcome.result), structured: outcome.result }
        : { ok: false, error: outcome.error };
    },
  },
  {
    name: REQUIRED_NAME,
    definition: REQUIRED_DEF,
    costTier: "pure",
    run(args, ctx) {
      const outcome = calculateRequiredSalePrice(args, ctx);
      return outcome.ok
        ? { ok: true, text: summarizeRequiredSalePrice(outcome.result), structured: outcome.result }
        : { ok: false, error: outcome.error };
    },
  },
  {
    name: EXPLAIN_NAME,
    definition: EXPLAIN_DEF,
    costTier: "pure",
    run(args, ctx) {
      const outcome = explainSellingMethod(args, ctx);
      return outcome.ok
        ? { ok: true, text: summarizeExplain(outcome.result), structured: outcome.result }
        : { ok: false, error: outcome.error };
    },
  },
  // --- Data-backed tools (Scout backend bridge) ---
  {
    name: identifyCard.TOOL_NAME,
    definition: identifyCard.TOOL_DEFINITION,
    costTier: "data",
    run: identifyCard.run,
  },
  {
    name: searchCardSales.TOOL_NAME,
    definition: searchCardSales.TOOL_DEFINITION,
    costTier: "data",
    run: searchCardSales.run,
  },
  {
    name: summarizeCardMarket.TOOL_NAME,
    definition: summarizeCardMarket.TOOL_DEFINITION,
    costTier: "data",
    run: summarizeCardMarket.run,
  },
  {
    name: getCardPriceHistory.TOOL_NAME,
    definition: getCardPriceHistory.TOOL_DEFINITION,
    costTier: "data",
    run: getCardPriceHistory.run,
  },
];

export const TOOL_DEFINITIONS = TOOLS.map((t) => t.definition);

export const DATA_TOOL_NAMES = new Set(TOOLS.filter((t) => t.costTier === "data").map((t) => t.name));

export function getTool(name: string): McpTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function isDataTool(name: string): boolean {
  return DATA_TOOL_NAMES.has(name);
}
