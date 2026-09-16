// =============================================================================
// TOOL: get_card_price_history  (data-backed)
// =============================================================================
// Build a chart-ready price-history time series for a card from the backend's
// sold-comp sample, aggregated with @pulltrader/scout-domain (single source of
// truth for bucketing/trend). Read-only.
// =============================================================================

import { buildPriceHistory, type HistoryInterval, type SaleRecordInput } from "@pulltrader/scout-domain";
import { toolError } from "../errors";
import type { ToolContext, ToolRun } from "./registry";
import { cardMarketRequest } from "../backend/client";
import { mapBackendError, money, CARD_QUERY_SCHEMA } from "./dataToolUtils";

export const TOOL_NAME = "get_card_price_history";

const INTERVALS: HistoryInterval[] = ["day", "week", "month"];

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: "Get the price history time series for a trading card",
  description:
    "Return a chart-ready price-history series for a trading card, aggregated from recent comparable sold sales into day/week/month buckets with a median per bucket and an overall trend. " +
    "Use this when a user asks 'how has the price changed', 'price over time', 'is it trending up or down', or wants a chart. Accepts a natural-language `query` or a structured `item`. " +
    "Series is built from sold-sale samples (and vendor TCG history when available); estimates only, not financial advice. Trading cards only.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...CARD_QUERY_SCHEMA,
      interval: {
        type: "string",
        enum: INTERVALS,
        default: "week",
        description: "Bucket size for the series. Defaults to week.",
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
  let interval: HistoryInterval = "week";
  if (a.interval !== undefined) {
    if (typeof a.interval !== "string" || !INTERVALS.includes(a.interval as HistoryInterval)) {
      return { ok: false, error: toolError("INVALID_INPUT", `interval must be one of: ${INTERVALS.join(", ")}.`, "interval") };
    }
    interval = a.interval as HistoryInterval;
  }

  const res = await cardMarketRequest(ctx.backend, { query, item });
  if (!res.ok) return { ok: false, error: mapBackendError(res.code, res.message) };

  const d = res.data;
  // Only dated sales with a real sale date can be bucketed.
  const records: SaleRecordInput[] = d.dated_sales
    .filter((s): s is { price: number; soldDate: string } => typeof s.soldDate === "string" && s.soldDate.length > 0)
    .map((s) => ({ price: s.price, soldDate: s.soldDate }));

  const history = buildPriceHistory(records, { interval, statistic: "median" });

  const structured = {
    query: d.query,
    category: d.category,
    interval: history.interval,
    series: history.series,
    trend: history.trend,
    sample_count: history.sampleCount,
    range: history.range,
    source: "pulltrader_sold_comps",
    vendor_tcg_history: d.tcg_price_history ?? undefined,
    data_freshness: { last_sold_date: history.dataUpdatedAt ?? d.data_freshness.last_sold_date, retrieved_at: d.data_freshness.retrieved_at },
    disclaimer: d.disclaimer,
  };

  let text: string;
  if (history.sampleCount === 0) {
    text = `Not enough dated sales to build a price history for ${d.query ?? "that card"}.`;
  } else {
    const dir = history.trend.direction;
    const chg =
      history.trend.changePercent !== null
        ? ` (${history.trend.changePercent > 0 ? "+" : ""}${history.trend.changePercent}% over the series)`
        : "";
    const nonEmpty = history.series.filter((p) => p.value !== null);
    const first = nonEmpty[0];
    const last = nonEmpty[nonEmpty.length - 1];
    text = [
      `Price history for ${d.query ?? "this card"}${d.category ? ` (${d.category})` : ""} by ${history.interval}: trend ${dir}${chg}, ${history.sampleCount} sales across ${history.series.length} buckets.`,
      first && last ? `From ${money(first.value)} (${first.periodStart}) to ${money(last.value)} (${last.periodStart}).` : "",
      d.disclaimer,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return { ok: true, text, structured };
}
