// =============================================================================
// PRICE HISTORY SERVICE (pure, chart-ready time series)
// =============================================================================
// Today there is NO real price-history service. Charts are fed vendor-provided
// JustTCG `priceHistory7d/30d` arrays, while ~153k rows of real sold prices sit
// in comp_sold_listings (with sold_date) and are never aggregated into a series.
//
// This module is the pure, deterministic aggregation core. It takes raw sold
// records (from comp_sold_listings, eBay, or a normalized vendor array), buckets
// them by day/week/month, computes a per-bucket statistic (median or mean, with
// optional outlier removal via the canonical CompStatsService), fills and flags
// gaps, and derives a simple trend. The model never generates chart points.
//
// The DB query lives in the backend; this function does the math so every
// surface (web chart, MCP get_card_price_history, Discord) produces identical
// series. Caller passes already-fetched rows.
// =============================================================================

import { summarizeCompStats, type OutlierMethod } from "../stats/compStats";
import { round2, toFiniteNumber } from "../money";

export type HistoryInterval = "day" | "week" | "month";
export type HistoryStatistic = "median" | "mean";
export type TrendDirection = "up" | "down" | "flat";

export interface SaleRecordInput {
  /** Sale price in dollars. */
  price: number;
  /** Sale date: Date, ISO string, or epoch ms. */
  soldDate: Date | string | number;
}

export interface PriceHistoryOptions {
  interval?: HistoryInterval; // default "week"
  statistic?: HistoryStatistic; // default "median"
  /** Inclusive range filter. Omitted bounds use the data's own min/max. */
  range?: { from?: Date | string | number; to?: Date | string | number };
  /** Outlier strategy applied per bucket. Default "IQR". */
  outlierMethod?: OutlierMethod;
  outlierMultiplier?: number;
  /** Fill empty interior buckets with a null-value gap marker. Default true. */
  fillGaps?: boolean;
}

export interface PriceHistoryPoint {
  /** ISO date (UTC) of the bucket start. */
  periodStart: string;
  /** Bucket statistic value, or null for a gap (no sales that bucket). */
  value: number | null;
  /** Number of sales contributing to this bucket. */
  sampleCount: number;
  low: number | null;
  high: number | null;
}

export interface PriceHistoryTrend {
  direction: TrendDirection;
  /** Percent change from the first to last non-empty bucket value. */
  changePercent: number | null;
  /** Absolute change first -> last non-empty bucket value. */
  changeAbsolute: number | null;
}

export interface PriceHistoryResult {
  interval: HistoryInterval;
  statistic: HistoryStatistic;
  series: PriceHistoryPoint[];
  /** Total sales across all buckets in range. */
  sampleCount: number;
  /** Bucket start ISO dates that had no sales (interior gaps only). */
  gaps: string[];
  trend: PriceHistoryTrend;
  range: { from: string | null; to: string | null };
  /** Most recent sale date in the data (data freshness). */
  dataUpdatedAt: string | null;
}

function toDate(value: Date | string | number): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC bucket start for a date at the given interval. */
function bucketStart(date: Date, interval: HistoryInterval): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (interval === "month") return new Date(Date.UTC(y, m, 1));
  if (interval === "day") return new Date(Date.UTC(y, m, d));
  // week: ISO-ish, snap to Monday 00:00 UTC
  const dayOfWeek = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(Date.UTC(y, m, d));
  monday.setUTCDate(monday.getUTCDate() - diffToMonday);
  return monday;
}

function advance(date: Date, interval: HistoryInterval): Date {
  const next = new Date(date.getTime());
  if (interval === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (interval === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Aggregate raw sold records into a chart-ready time series. Pure and
 * deterministic: identical inputs always produce identical output.
 */
export function buildPriceHistory(
  records: readonly SaleRecordInput[],
  options: PriceHistoryOptions = {},
): PriceHistoryResult {
  const {
    interval = "week",
    statistic = "median",
    outlierMethod = "IQR",
    outlierMultiplier = 1.5,
    fillGaps = true,
  } = options;

  const fromBound = options.range?.from != null ? toDate(options.range.from) : null;
  const toBound = options.range?.to != null ? toDate(options.range.to) : null;

  // Normalize + filter to valid records within range.
  const valid: { price: number; date: Date }[] = [];
  for (const r of records) {
    const date = toDate(r.soldDate);
    const price = toFiniteNumber(r.price, NaN);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    if (fromBound && date < fromBound) continue;
    if (toBound && date > toBound) continue;
    valid.push({ price, date });
  }

  if (valid.length === 0) {
    return {
      interval,
      statistic,
      series: [],
      sampleCount: 0,
      gaps: [],
      trend: { direction: "flat", changePercent: null, changeAbsolute: null },
      range: { from: fromBound ? isoDate(fromBound) : null, to: toBound ? isoDate(toBound) : null },
      dataUpdatedAt: null,
    };
  }

  valid.sort((a, b) => a.date.getTime() - b.date.getTime());

  const buckets = new Map<string, number[]>();
  let maxDate = valid[0]!.date;
  for (const { price, date } of valid) {
    const key = isoDate(bucketStart(date, interval));
    const arr = buckets.get(key);
    if (arr) arr.push(price);
    else buckets.set(key, [price]);
    if (date > maxDate) maxDate = date;
  }

  const firstStart = bucketStart(valid[0]!.date, interval);
  const lastStart = bucketStart(valid[valid.length - 1]!.date, interval);

  const series: PriceHistoryPoint[] = [];
  const gaps: string[] = [];

  let cursor = new Date(firstStart.getTime());
  while (cursor <= lastStart) {
    const key = isoDate(cursor);
    const prices = buckets.get(key);
    if (prices && prices.length > 0) {
      const stats = summarizeCompStats(prices, { outlierMethod, outlierMultiplier });
      const value = statistic === "mean" ? stats.mean : stats.median;
      series.push({
        periodStart: key,
        value,
        sampleCount: prices.length,
        low: stats.low,
        high: stats.high,
      });
    } else if (fillGaps) {
      gaps.push(key);
      series.push({ periodStart: key, value: null, sampleCount: 0, low: null, high: null });
    }
    cursor = advance(cursor, interval);
  }

  const nonEmpty = series.filter((p) => p.value !== null);
  const firstVal = nonEmpty.length > 0 ? nonEmpty[0]!.value! : null;
  const lastVal = nonEmpty.length > 0 ? nonEmpty[nonEmpty.length - 1]!.value! : null;

  let trend: PriceHistoryTrend = { direction: "flat", changePercent: null, changeAbsolute: null };
  if (firstVal !== null && lastVal !== null) {
    const changeAbsolute = round2(lastVal - firstVal);
    const changePercent = firstVal > 0 ? round2(((lastVal - firstVal) / firstVal) * 100) : null;
    const direction: TrendDirection =
      changeAbsolute > 0 ? "up" : changeAbsolute < 0 ? "down" : "flat";
    trend = { direction, changePercent, changeAbsolute };
  }

  return {
    interval,
    statistic,
    series,
    sampleCount: valid.length,
    gaps,
    trend,
    range: {
      from: isoDate(valid[0]!.date),
      to: isoDate(valid[valid.length - 1]!.date),
    },
    dataUpdatedAt: maxDate.toISOString(),
  };
}
