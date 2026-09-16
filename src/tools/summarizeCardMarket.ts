// =============================================================================
// TOOL: summarize_card_market  (data-backed)
// =============================================================================
// Canonical market summary (median/mean/percentiles/volatility/confidence) for a
// card, computed with @pulltrader/scout-domain over the backend's sold-comp
// sample. Read-only.
// =============================================================================

import { summarizeCompStats } from "@pulltrader/scout-domain";
import { toolError } from "../errors";
import type { ToolContext, ToolRun } from "./registry";
import { cardMarketRequest } from "../backend/client";
import { mapBackendError, money, CARD_QUERY_SCHEMA } from "./dataToolUtils";

export const TOOL_NAME = "summarize_card_market";

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: "Summarize the current market for a trading card",
  description:
    "Return a canonical market summary for a trading card from recent comparable sales: median, mean, 10th–90th percentile range, volatility, and a confidence level based on sample size and dispersion. " +
    "Use this when a user asks 'what's it worth', 'market value', or 'how volatile is this card'. Accepts a natural-language `query` or a structured `item`. " +
    "Estimates from recent sales, excluding fees/taxes/shipping; not financial advice. Trading cards only.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { ...CARD_QUERY_SCHEMA },
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

  const res = await cardMarketRequest(ctx.backend, { query, item });
  if (!res.ok) return { ok: false, error: mapBackendError(res.code, res.message) };

  const d = res.data;
  const prices = d.dated_sales.map((s) => s.price);
  const s = summarizeCompStats(prices);

  const structured = {
    query: d.query,
    category: d.category,
    sample_count: d.sample_count,
    is_graded: d.is_graded,
    market_value: d.market_value,
    value_source: d.value_source,
    image: d.image,
    price_change_7d: d.price_change_7d,
    price_change_30d: d.price_change_30d,
    summary: s,
    reference_stats: d.reference_stats,
    last_sold_date: d.data_freshness.last_sold_date,
    ebay_search_url: d.ebay_search_url,
    data_freshness: d.data_freshness,
    disclaimer: d.disclaimer,
  };

  // Vendor (JustTCG/CardSightAI) pricing is authoritative for raw cards and leads
  // the headline; the backend already applies grade-aware precedence (graded ->
  // eBay), so value_source !== "eBay Comps" means a vendor price won.
  const vendorPrimary = typeof d.market_value === "number" && !!d.value_source && d.value_source !== "eBay Comps";

  let text: string;
  if (vendorPrimary) {
    const chg = typeof d.price_change_7d === "number" ? ` (7d ${d.price_change_7d > 0 ? "+" : ""}${d.price_change_7d}%)` : "";
    const parts = [
      `Market value for ${d.query ?? "this card"}${d.category ? ` (${d.category})` : ""}: ${money(d.market_value)} (${d.value_source})${chg}.`,
    ];
    if (s.sampleCount > 0) {
      parts.push(`eBay sold comps (reference): median ${money(s.median)} across ${s.sampleCount} comps, range ${money(s.low)}–${money(s.high)}.`);
    }
    parts.push(d.disclaimer);
    text = parts.join("\n");
  } else if (s.sampleCount === 0) {
    // No dated eBay comps to aggregate and no vendor price.
    if (typeof d.market_value === "number") {
      const src = d.value_source ?? "vendor";
      const chg = typeof d.price_change_7d === "number" ? ` (7d ${d.price_change_7d > 0 ? "+" : ""}${d.price_change_7d}%)` : "";
      text = `Market value for ${d.query ?? "this card"}${d.category ? ` (${d.category})` : ""}: ${money(d.market_value)} (${src})${chg}.\n${d.disclaimer}`;
    } else {
      text = `Not enough recent sales to summarize the market for ${d.query ?? "that card"}. Try a more specific description.`;
    }
  } else {
    // eBay-primary (graded cards, or no vendor price): comp distribution summary.
    const parts = [
      `Market for ${d.query ?? "this card"}${d.category ? ` (${d.category})` : ""}: median ${money(s.median)}, mean ${money(s.mean)}.`,
      `Typical range (p10–p90) ${money(s.p10)}–${money(s.p90)}; full range ${money(s.low)}–${money(s.high)}.`,
      `Volatility ${s.volatility ?? "n/a"}%${typeof s.volatility === "number" ? " (CoV)" : ""}, confidence ${s.confidence} from ${s.sampleCount} comps${s.outliersRemoved > 0 ? ` (${s.outliersRemoved} outliers removed)` : ""}.`,
    ];
    if (d.data_freshness.last_sold_date) parts.push(`Most recent sale ${d.data_freshness.last_sold_date.slice(0, 10)}.`);
    parts.push(d.disclaimer);
    text = parts.join("\n");
  }

  return { ok: true, text, structured };
}
