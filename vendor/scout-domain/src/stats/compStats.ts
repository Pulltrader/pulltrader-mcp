// =============================================================================
// CANONICAL COMPARABLE-SALES STATISTICS
// =============================================================================
// Today the same "market stats from a list of sold prices" math is implemented
// at least three different ways, with three different output shapes:
//
//   1. pulltrader-backend/services/compSearchService.js  (calculateStats)
//        -> sample_count, median, mean, low, high, std_dev
//   2. pulltrader-backend/src/scout-v2/services/ebay-service.js (calculateStats)
//        -> sample_count, median, mean, p10, p90, std_dev, volatility (CV%)
//   3. cardSightAiService.extractCompFromPricingResponse (20/50/80 percentiles)
//
// Because the definitions differ (low/high vs p10/p90, IQR vs none, population
// std), the SAME card can get different "market summary" numbers depending on
// which surface answered. This module is the single canonical definition.
//
// It computes a superset of every field the legacy implementations produced,
// and ships exact-shape adapters (`toCompSearchStats`, `toScoutV2Stats`) so
// callers can be migrated one at a time without changing their output contract.
// Parity with the legacy functions is locked by compStats.test.ts.
// =============================================================================

import { round2 } from "../money";

export type OutlierMethod = "none" | "IQR" | "MAD";

export interface CompStatsOptions {
  /** Outlier strategy applied before computing stats. Default: "IQR". */
  outlierMethod?: OutlierMethod;
  /** IQR / MAD multiplier. Default: 1.5 (matches both legacy implementations). */
  outlierMultiplier?: number;
  /** Symmetric trim ratio (each tail) for the trimmed mean. Default: 0.1. */
  trimRatio?: number;
}

export type Confidence = "high" | "medium" | "low";

export interface CompStats {
  /** Count used for the statistics (AFTER outlier removal). */
  sampleCount: number;
  /** Count of input prices BEFORE outlier removal. */
  rawCount: number;
  /** rawCount - sampleCount. */
  outliersRemoved: number;
  low: number | null;
  high: number | null;
  mean: number | null;
  median: number | null;
  /** Symmetric trimmed mean (drops trimRatio from each tail). */
  trimmedMean: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  /** Population standard deviation. */
  stdDev: number | null;
  /** Coefficient of variation as a percentage (stdDev / mean * 100). */
  volatility: number | null;
  /** high - low. */
  range: number | null;
  /** Heuristic confidence based on sample size and dispersion. */
  confidence: Confidence;
}

function sanitize(prices: readonly number[]): number[] {
  return prices.filter((p) => typeof p === "number" && Number.isFinite(p));
}

/** Value at index floor(n * fraction), matching the legacy percentile indexing. */
function percentileByFloorIndex(sorted: readonly number[], fraction: number): number {
  const n = sorted.length;
  const idx = Math.min(Math.max(Math.floor(n * fraction), 0), n - 1);
  return sorted[idx] as number;
}

/**
 * Remove outliers. IQR (default) and MAD mirror the scout-v2 ebay-service
 * implementation; "none" returns the input unchanged. With fewer than 4 values
 * the input is returned unchanged (IQR is not meaningful on tiny samples) —
 * this matches both legacy implementations.
 */
export function removeOutliers(
  prices: readonly number[],
  method: OutlierMethod = "IQR",
  multiplier = 1.5,
): number[] {
  const clean = sanitize(prices);
  if (method === "none") return clean;
  if (clean.length < 4) return clean;

  const sorted = [...clean].sort((a, b) => a - b);

  if (method === "MAD") {
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    const deviations = clean.map((p) => Math.abs(p - median)).sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)] as number;
    const threshold = multiplier * mad;
    return clean.filter((p) => Math.abs(p - median) <= threshold);
  }

  // IQR
  const q1 = sorted[Math.floor(sorted.length * 0.25)] as number;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] as number;
  const iqr = q3 - q1;
  const lower = q1 - multiplier * iqr;
  const upper = q3 + multiplier * iqr;
  return clean.filter((p) => p >= lower && p <= upper);
}

function deriveConfidence(sampleCount: number, volatility: number | null): Confidence {
  if (sampleCount >= 15 && (volatility ?? 0) <= 25) return "high";
  if (sampleCount < 5 || (volatility ?? 0) > 60) return "low";
  return "medium";
}

/**
 * Canonical market summary from a list of sold prices. Computes the superset of
 * every legacy field. Outlier removal is applied first (default IQR @ 1.5).
 */
export function summarizeCompStats(
  prices: readonly number[],
  options: CompStatsOptions = {},
): CompStats {
  const { outlierMethod = "IQR", outlierMultiplier = 1.5, trimRatio = 0.1 } = options;

  const raw = sanitize(prices);
  const rawCount = raw.length;
  const kept = removeOutliers(raw, outlierMethod, outlierMultiplier);

  if (kept.length === 0) {
    return {
      sampleCount: 0,
      rawCount,
      outliersRemoved: rawCount,
      low: null,
      high: null,
      mean: null,
      median: null,
      trimmedMean: null,
      p10: null,
      p25: null,
      p75: null,
      p90: null,
      stdDev: null,
      volatility: null,
      range: null,
      confidence: "low",
    };
  }

  const sorted = [...kept].sort((a, b) => a - b);
  const n = sorted.length;

  const median =
    n % 2 === 0
      ? ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2
      : (sorted[Math.floor(n / 2)] as number);

  const mean = kept.reduce((s, p) => s + p, 0) / n;
  const variance = kept.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const volatilityRaw = mean > 0 ? (stdDev / mean) * 100 : null;

  // Symmetric trimmed mean.
  const trimCount = Math.floor(n * trimRatio);
  const trimmedSlice = sorted.slice(trimCount, n - trimCount);
  const trimmedMean =
    trimmedSlice.length > 0
      ? trimmedSlice.reduce((s, p) => s + p, 0) / trimmedSlice.length
      : mean;

  const low = sorted[0] as number;
  const high = sorted[n - 1] as number;

  return {
    sampleCount: n,
    rawCount,
    outliersRemoved: rawCount - n,
    low: round2(low),
    high: round2(high),
    mean: round2(mean),
    median: round2(median),
    trimmedMean: round2(trimmedMean),
    p10: round2(percentileByFloorIndex(sorted, 0.1)),
    p25: round2(percentileByFloorIndex(sorted, 0.25)),
    p75: round2(percentileByFloorIndex(sorted, 0.75)),
    p90: round2(percentileByFloorIndex(sorted, 0.9)),
    stdDev: round2(stdDev),
    volatility: volatilityRaw === null ? null : round2(volatilityRaw),
    range: round2(high - low),
    confidence: deriveConfidence(n, volatilityRaw === null ? null : round2(volatilityRaw)),
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible adapters (exact legacy output shapes)
// ---------------------------------------------------------------------------

/** Legacy shape from pulltrader-backend/services/compSearchService.js. */
export interface CompSearchStatsShape {
  sample_count: number;
  median_price: number;
  mean_price: number;
  low_price: number;
  high_price: number;
  std_dev: number;
}

/**
 * Reproduces compSearchService.calculateStats EXACTLY (no outlier removal — the
 * legacy orchestrator calls removeOutliers separately before this). Returns null
 * for an empty input, matching the legacy function.
 */
export function toCompSearchStats(prices: readonly number[]): CompSearchStatsShape | null {
  const clean = sanitize(prices);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const n = sorted.length;
  const median =
    n % 2 === 0
      ? ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2
      : (sorted[Math.floor(n / 2)] as number);
  const mean = clean.reduce((s, p) => s + p, 0) / n;
  const variance = clean.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  return {
    sample_count: n,
    median_price: Math.round(median * 100) / 100,
    mean_price: Math.round(mean * 100) / 100,
    low_price: Math.round((sorted[0] as number) * 100) / 100,
    high_price: Math.round((sorted[n - 1] as number) * 100) / 100,
    std_dev: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

/** Legacy shape from pulltrader-backend/src/scout-v2/services/ebay-service.js. */
export interface ScoutV2StatsShape {
  sample_count: number;
  median_price: number | null;
  mean_price: number | null;
  p10_price: number | null;
  p90_price: number | null;
  std_dev: number | null;
  volatility: number | null;
}

/**
 * Reproduces scout-v2 ebay-service.calculateStats EXACTLY (no outlier removal —
 * the legacy caller removes outliers first). Returns the all-null object for an
 * empty input, matching the legacy function (including its `volatility ? .. :
 * null` quirk where a zero CV becomes null).
 */
export function toScoutV2Stats(prices: readonly number[]): ScoutV2StatsShape {
  const clean = sanitize(prices);
  if (clean.length === 0) {
    return {
      sample_count: 0,
      median_price: null,
      mean_price: null,
      p10_price: null,
      p90_price: null,
      std_dev: null,
      volatility: null,
    };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const n = sorted.length;
  const median =
    n % 2 === 0
      ? ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2
      : (sorted[Math.floor(n / 2)] as number);
  const mean = clean.reduce((s, p) => s + p, 0) / n;
  const p10 = (sorted[Math.floor(n * 0.1)] as number) || (sorted[0] as number);
  const p90 = (sorted[Math.floor(n * 0.9)] as number) || (sorted[n - 1] as number);
  const variance = clean.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const volatility = mean > 0 ? (stdDev / mean) * 100 : null;
  return {
    sample_count: n,
    median_price: Math.round(median * 100) / 100,
    mean_price: Math.round(mean * 100) / 100,
    p10_price: Math.round(p10 * 100) / 100,
    p90_price: Math.round(p90 * 100) / 100,
    std_dev: Math.round(stdDev * 100) / 100,
    volatility: volatility ? Math.round(volatility * 100) / 100 : null,
  };
}
