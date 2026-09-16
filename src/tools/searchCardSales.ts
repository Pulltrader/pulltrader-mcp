// =============================================================================
// TOOL: search_card_sales  (data-backed)
// =============================================================================
// Return recent comparable SOLD listings for a card via the Scout backend
// bridge, plus a canonical market snapshot computed with @pulltrader/scout-domain.
// Read-only. Limited-public: capped sample, no outbound listing URLs.
// =============================================================================

import { summarizeCompStats } from "@pulltrader/scout-domain";
import { toolError } from "../errors";
import type { ToolContext, ToolRun } from "./registry";
import { cardMarketRequest } from "../backend/client";
import { mapBackendError, money, CARD_QUERY_SCHEMA } from "./dataToolUtils";

export const TOOL_NAME = "search_card_sales";

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: "Find recent comparable sold sales for a trading card",
  description:
    "Return a capped sample of recent comparable SOLD listings for a trading card (price + sale date), plus a market snapshot (median, range, sample size). " +
    "Use this when a user asks 'what is this card selling for', 'recent sales', or 'comps'. Accepts a natural-language `query` or a structured `item`. " +
    "Figures are estimates from recent sales and exclude fees/taxes/shipping; this is not financial advice and does not place orders. Trading cards only.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...CARD_QUERY_SCHEMA,
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        default: 10,
        description: "Maximum number of example sales to return (1–10).",
      },
    },
  },
} as const;

export async function run(args: unknown, ctx: ToolContext): Promise<ToolRun> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, error: toolError("INVALID_INPUT", "Arguments must be an object.") };
  }
  const a = args as Record<string, unknown>;
  const query = typeof a.query === "string" ? a.query.trim() : undefined;
  const item = typeof a.item === "object" && a.item !== null && !Array.isArray(a.item) ? (a.item as Record<string, unknown>) : undefined;
  if (!query && !item) {
    return { ok: false, error: toolError("INVALID_INPUT", "Either 'query' (string) or 'item' (object) is required.") };
  }
  let limit = 10;
  if (a.limit !== undefined) {
    if (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > 10) {
      return { ok: false, error: toolError("INVALID_INPUT", "limit must be an integer between 1 and 10.", "limit") };
    }
    limit = a.limit;
  }

  const res = await cardMarketRequest(ctx.backend, { query, item });
  if (!res.ok) return { ok: false, error: mapBackendError(res.code, res.message) };

  const d = res.data;
  const prices = d.dated_sales.map((s) => s.price);
  const market = summarizeCompStats(prices);
  const sales = d.example_sales.slice(0, limit);

  const structured = {
    query: d.query,
    category: d.category,
    sample_count: d.sample_count,
    has_partial_matches: d.has_partial_matches,
    is_graded: d.is_graded,
    market_value: d.market_value,
    value_source: d.value_source,
    image: d.image,
    market: {
      median: market.median,
      mean: market.mean,
      low: market.low,
      high: market.high,
      p10: market.p10,
      p90: market.p90,
      std_dev: market.stdDev,
      volatility: market.volatility,
      confidence: market.confidence,
      sample_count: market.sampleCount,
    },
    sales,
    ebay_search_url: d.ebay_search_url,
    data_freshness: d.data_freshness,
    disclaimer: d.disclaimer,
  };

  // For raw cards the backend makes a vendor (JustTCG/CardSightAI) price the
  // headline; eBay comps below are supporting reference. value_source !== "eBay
  // Comps" means a vendor price won the grade-aware precedence.
  const vendorPrimary = typeof d.market_value === "number" && !!d.value_source && d.value_source !== "eBay Comps";

  let text: string;
  if (d.sample_count === 0 || prices.length === 0) {
    if (typeof d.market_value === "number") {
      const src = d.value_source ?? "vendor";
      text = `No dated sold comps for ${d.query ?? "that card"}, but a current market value is available: ${money(d.market_value)} (${src}).\n${d.disclaimer}`;
    } else {
      text = `No recent sold comps found for ${d.query ?? "that card"}. Try a more specific description (year, set, player, grade).`;
    }
  } else {
    const lines: string[] = [];
    if (vendorPrimary) {
      lines.push(`Market value for ${d.query ?? "this card"}${d.category ? ` (${d.category})` : ""}: ${money(d.market_value)} (${d.value_source}).`);
      lines.push(`${d.sample_count} recent eBay sold comp${d.sample_count === 1 ? "" : "s"} (reference): median ${money(market.median)}, range ${money(market.low)}–${money(market.high)} (confidence ${market.confidence}).`);
    } else {
      lines.push(`${d.sample_count} recent sold comp${d.sample_count === 1 ? "" : "s"} for ${d.query ?? "this card"}${d.category ? ` (${d.category})` : ""}: median ${money(market.median)}, range ${money(market.low)}–${money(market.high)} (confidence ${market.confidence}).`);
    }
    for (const s of sales.slice(0, 3)) {
      lines.push(`- ${money(s.price)}${s.sold_date ? ` on ${s.sold_date.slice(0, 10)}` : ""}: ${s.title}`);
    }
    if (d.has_partial_matches) lines.push("Some results are partial matches.");
    lines.push(d.disclaimer);
    text = lines.join("\n");
  }

  return { ok: true, text, structured };
}
