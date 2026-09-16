import { describe, it, expect } from "vitest";
import { buildPriceHistory, type SaleRecordInput } from "./priceHistoryService";

describe("buildPriceHistory", () => {
  it("returns an empty result for no records", () => {
    const res = buildPriceHistory([]);
    expect(res.series).toEqual([]);
    expect(res.sampleCount).toBe(0);
    expect(res.dataUpdatedAt).toBeNull();
    expect(res.trend.direction).toBe("flat");
  });

  it("buckets by month and computes the median per bucket", () => {
    const records: SaleRecordInput[] = [
      { price: 100, soldDate: "2026-01-05" },
      { price: 120, soldDate: "2026-01-20" },
      { price: 110, soldDate: "2026-01-25" },
      { price: 200, soldDate: "2026-03-10" },
      { price: 220, soldDate: "2026-03-15" },
    ];
    const res = buildPriceHistory(records, { interval: "month", statistic: "median" });
    // Jan, Feb (gap), Mar
    expect(res.series.map((p) => p.periodStart)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(res.series[0]!.value).toBe(110); // median of 100,110,120
    expect(res.series[1]!.value).toBeNull(); // February gap
    expect(res.series[1]!.sampleCount).toBe(0);
    expect(res.series[2]!.value).toBe(210); // median of 200,220
    expect(res.gaps).toEqual(["2026-02-01"]);
    expect(res.sampleCount).toBe(5);
  });

  it("computes an upward trend from first to last non-empty bucket", () => {
    const records: SaleRecordInput[] = [
      { price: 100, soldDate: "2026-01-05" },
      { price: 200, soldDate: "2026-03-10" },
    ];
    const res = buildPriceHistory(records, { interval: "month" });
    expect(res.trend.direction).toBe("up");
    expect(res.trend.changeAbsolute).toBe(100);
    expect(res.trend.changePercent).toBe(100);
  });

  it("respects a range filter", () => {
    const records: SaleRecordInput[] = [
      { price: 50, soldDate: "2025-12-01" },
      { price: 100, soldDate: "2026-01-15" },
      { price: 999, soldDate: "2026-06-01" },
    ];
    const res = buildPriceHistory(records, {
      interval: "month",
      range: { from: "2026-01-01", to: "2026-02-01" },
    });
    expect(res.sampleCount).toBe(1);
    expect(res.series.every((p) => p.value === null || p.value === 100)).toBe(true);
  });

  it("ignores invalid prices and dates", () => {
    const records = [
      { price: 0, soldDate: "2026-01-05" },
      { price: -5, soldDate: "2026-01-06" },
      { price: 100, soldDate: "not-a-date" },
      { price: 150, soldDate: "2026-01-10" },
    ] as SaleRecordInput[];
    const res = buildPriceHistory(records, { interval: "month" });
    expect(res.sampleCount).toBe(1);
    expect(res.series[0]!.value).toBe(150);
  });

  it("buckets by ISO week (Monday start)", () => {
    const records: SaleRecordInput[] = [
      { price: 10, soldDate: "2026-01-07" }, // Wednesday
      { price: 20, soldDate: "2026-01-08" }, // Thursday (same week)
    ];
    const res = buildPriceHistory(records, { interval: "week", statistic: "mean" });
    expect(res.series).toHaveLength(1);
    expect(res.series[0]!.periodStart).toBe("2026-01-05"); // Monday
    expect(res.series[0]!.value).toBe(15);
  });
});
