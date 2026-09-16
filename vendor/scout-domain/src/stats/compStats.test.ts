import { describe, it, expect } from "vitest";
import {
  summarizeCompStats,
  removeOutliers,
  toCompSearchStats,
  toScoutV2Stats,
} from "./compStats";

// ---------------------------------------------------------------------------
// Legacy oracles — copied VERBATIM from production so parity is provable.
// ---------------------------------------------------------------------------

// pulltrader-backend/services/compSearchService.js
function legacyCompSearchRemoveOutliers(prices: number[]): number[] {
  if (prices.length < 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return prices.filter((p) => p >= lower && p <= upper);
}

function legacyCompSearchCalculateStats(prices: number[]) {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2 : sorted[Math.floor(n / 2)]!;
  const mean = prices.reduce((s, p) => s + p, 0) / n;
  const variance = prices.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / n;
  return {
    sample_count: n,
    median_price: Math.round(median * 100) / 100,
    mean_price: Math.round(mean * 100) / 100,
    low_price: Math.round(sorted[0]! * 100) / 100,
    high_price: Math.round(sorted[n - 1]! * 100) / 100,
    std_dev: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

// pulltrader-backend/src/scout-v2/services/ebay-service.js (IQR, multiplier 1.5)
function legacyScoutV2RemoveOutliers(prices: number[], multiplier = 1.5): number[] {
  if (prices.length < 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  const iqr = q3 - q1;
  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;
  return prices.filter((p) => p >= lowerBound && p <= upperBound);
}

function legacyScoutV2CalculateStats(prices: number[]) {
  if (prices.length === 0) {
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
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2 : sorted[Math.floor(n / 2)]!;
  const mean = prices.reduce((sum, p) => sum + p, 0) / n;
  const p10 = sorted[Math.floor(n * 0.1)]! || sorted[0]!;
  const p90 = sorted[Math.floor(n * 0.9)]! || sorted[n - 1]!;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / n;
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

// ---------------------------------------------------------------------------
// Deterministic price-array fixtures (cover small, even/odd, outliers, dupes)
// ---------------------------------------------------------------------------

const FIXTURES: number[][] = [
  [],
  [42.5],
  [10, 20],
  [10, 20, 30],
  [10, 20, 30, 40],
  [5, 5, 5, 5, 5],
  [100, 105, 98, 102, 99, 101, 5000], // single high outlier
  [12.34, 56.78, 90.12, 34.56, 78.9, 23.45, 67.89, 11.11],
  [3000, 3050, 2950, 3100, 2900, 3105, 2800, 3200, 3000, 2750],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
];

// Seeded pseudo-random arrays for breadth.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
function randomArrays(): number[][] {
  const rnd = seeded(1337);
  const out: number[][] = [];
  for (let i = 0; i < 40; i++) {
    const len = Math.floor(rnd() * 30);
    const arr: number[] = [];
    for (let j = 0; j < len; j++) {
      arr.push(Math.round(rnd() * 500000) / 100); // 2dp dollars up to $5000
    }
    out.push(arr);
  }
  return out;
}

const ALL = [...FIXTURES, ...randomArrays()];

describe("CompStats parity with legacy compSearchService", () => {
  it("toCompSearchStats reproduces calculateStats exactly", () => {
    for (const prices of ALL) {
      expect(toCompSearchStats(prices)).toEqual(legacyCompSearchCalculateStats(prices));
    }
  });

  it("removeOutliers (IQR @1.5) reproduces legacy removeOutliers", () => {
    for (const prices of ALL) {
      expect(removeOutliers(prices, "IQR", 1.5)).toEqual(legacyCompSearchRemoveOutliers(prices));
    }
  });
});

describe("CompStats parity with legacy scout-v2 ebay-service", () => {
  it("toScoutV2Stats reproduces calculateStats exactly (incl. null quirks)", () => {
    for (const prices of ALL) {
      expect(toScoutV2Stats(prices)).toEqual(legacyScoutV2CalculateStats(prices));
    }
  });

  it("removeOutliers (IQR) reproduces legacy scout-v2 removeOutliers", () => {
    for (const prices of ALL) {
      expect(removeOutliers(prices, "IQR", 1.5)).toEqual(legacyScoutV2RemoveOutliers(prices, 1.5));
    }
  });
});

describe("summarizeCompStats canonical superset", () => {
  it("removes a clear high outlier before summarizing", () => {
    const prices = [100, 105, 98, 102, 99, 101, 5000];
    const stats = summarizeCompStats(prices, { outlierMethod: "IQR" });
    expect(stats.rawCount).toBe(7);
    expect(stats.outliersRemoved).toBe(1);
    expect(stats.high).toBeLessThan(5000);
    expect(stats.sampleCount).toBe(6);
  });

  it("matches legacy low/high/mean/median/std after the same outlier pass", () => {
    const prices = [3000, 3050, 2950, 3100, 2900, 3105, 2800, 3200, 3000, 2750];
    const legacy = legacyCompSearchCalculateStats(legacyCompSearchRemoveOutliers(prices))!;
    const stats = summarizeCompStats(prices, { outlierMethod: "IQR", outlierMultiplier: 1.5 });
    expect(stats.sampleCount).toBe(legacy.sample_count);
    expect(stats.low).toBe(legacy.low_price);
    expect(stats.high).toBe(legacy.high_price);
    expect(stats.median).toBe(legacy.median_price);
    expect(stats.mean).toBe(legacy.mean_price);
    expect(stats.stdDev).toBe(legacy.std_dev);
  });

  it("returns an all-null/zero summary for empty input", () => {
    const stats = summarizeCompStats([]);
    expect(stats.sampleCount).toBe(0);
    expect(stats.median).toBeNull();
    expect(stats.confidence).toBe("low");
  });

  it("derives confidence from sample size and dispersion", () => {
    const tight = Array.from({ length: 30 }, (_, i) => 100 + (i % 3)); // low CV, n=30
    expect(summarizeCompStats(tight).confidence).toBe("high");
    expect(summarizeCompStats([100, 900, 50]).confidence).toBe("low"); // n<5
  });
});
