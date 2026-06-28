import { describe, it, expect } from "vitest";
import { compareSellingCosts, summarizeComparison } from "../src/tools/compareSellingCosts";

const NOW = new Date("2026-06-27T12:00:00Z");

function ok(args: unknown) {
  const r = compareSellingCosts(args, { now: NOW });
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.result;
}

describe("compare_selling_costs: validation", () => {
  it("requires a numeric sale_price", () => {
    const r = compareSellingCosts({}, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_INPUT");
  });
  it("rejects non-positive sale_price", () => {
    for (const v of [0, -5]) {
      const r = compareSellingCosts({ sale_price: v }, { now: NOW });
      expect(r.ok).toBe(false);
    }
  });
  it("rejects NaN/Infinity", () => {
    const r = compareSellingCosts({ sale_price: Number.POSITIVE_INFINITY }, { now: NOW });
    expect(r.ok).toBe(false);
  });
  it("rejects unsupported currency", () => {
    const r = compareSellingCosts({ sale_price: 100, currency: "EUR" }, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNSUPPORTED_CURRENCY");
  });
  it("rejects unsupported category", () => {
    const r = compareSellingCosts({ sale_price: 100, item_category: "shoes" }, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNSUPPORTED_CATEGORY");
  });
  it("rejects unsupported selling method", () => {
    const r = compareSellingCosts({ sale_price: 100, methods: ["amazon"] }, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNSUPPORTED_SELLING_METHOD");
  });
  it("rejects non-integer quantity", () => {
    const r = compareSellingCosts({ sale_price: 100, quantity: 1.5 }, { now: NOW });
    expect(r.ok).toBe(false);
  });
});

describe("compare_selling_costs: defaults & shape", () => {
  it("compares the three default methods with eBay as baseline", () => {
    const r = ok({ sale_price: 100 });
    expect(r.methods.map((m) => m.method)).toEqual(["ebay", "pulltrader_marketplace", "pulltrader_storefront"]);
    expect(r.baseline_method).toBe("ebay");
    expect(r.currency).toBe("USD");
    expect(r.calculated_at).toBe(NOW.toISOString());
    expect(r.fee_schedule_version).toContain("ebay:");
    expect(r.fee_schedule_version).toContain("pulltrader:");
    expect(r.related_url).toContain("pulltrader.app");
  });
  it("tracks provided vs default inputs", () => {
    const r = ok({ sale_price: 100, seller_plan: "pro" });
    const plan = r.inputs_used.find((i) => i.field === "seller_plan");
    const currency = r.inputs_used.find((i) => i.field === "currency");
    expect(plan?.source).toBe("provided");
    expect(currency?.source).toBe("default");
  });
  it("computes difference_from_baseline and best_for_seller", () => {
    const r = ok({ sale_price: 100 });
    const storefront = r.difference_from_baseline.find((d) => d.method === "pulltrader_storefront");
    // storefront 100 vs eBay 86.35 -> +13.65
    expect(storefront?.amount).toBe(13.65);
    expect(r.best_for_seller).toBe("pulltrader_storefront");
  });
  it("applies the eBay Store subscriber rate when requested", () => {
    const individual = ok({ sale_price: 100, methods: ["ebay"] }).methods[0]!;
    const store = ok({ sale_price: 100, methods: ["ebay"], ebay_store_subscription: true }).methods[0]!;
    expect(individual.estimated_total_fees).toBe(13.65);
    expect(store.estimated_total_fees).toBe(12.75);
  });
  it("honors seller_covers_fees and ebay override", () => {
    const r = ok({ sale_price: 100, seller_covers_fees: true, methods: ["pulltrader_storefront"] });
    expect(r.methods[0]!.estimated_payout).toBe(96.35);
  });
  it("computes net profit when acquisition_cost is supplied", () => {
    const r = ok({ sale_price: 100, acquisition_cost: 40, methods: ["pulltrader_marketplace"] });
    expect(r.methods[0]!.estimated_net_profit).toBe(51);
  });
});

describe("compare_selling_costs: competitor marketplaces (opt-in)", () => {
  it("are excluded from the default comparison", () => {
    const r = ok({ sale_price: 100 });
    const competitor = r.methods.find((m) =>
      ["tcgplayer", "manapool", "misprint", "fanatics_collect", "goldin"].includes(m.method),
    );
    expect(competitor).toBeUndefined();
    expect(r.competitor_fee_schedules).toBeUndefined();
  });
  it("are included when requested, with provenance and an assumption", () => {
    const r = ok({ sale_price: 100, methods: ["ebay", "tcgplayer", "goldin"] });
    expect(r.methods.map((m) => m.method)).toEqual(["ebay", "tcgplayer", "goldin"]);
    expect(r.baseline_method).toBe("ebay");
    expect(r.competitor_fee_schedules?.map((c) => c.method)).toEqual(["tcgplayer", "goldin"]);
    expect(r.competitor_fee_schedules?.every((c) => c.estimated === true && c.source_url.startsWith("https://"))).toBe(
      true,
    );
    expect(r.assumptions.join(" ").toLowerCase()).toContain("auction formats");
  });
  it("warns when a requested competitor schedule is stale", () => {
    const r = compareSellingCosts(
      { sale_price: 100, methods: ["misprint"] },
      { now: new Date("2027-01-01T00:00:00Z") },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.warnings.join(" ")).toMatch(/misprint/i);
      expect(r.result.warnings.join(" ")).toMatch(/out of date/i);
    }
  });
});

describe("compare_selling_costs: fee schedule freshness", () => {
  it("warns when a schedule is past its review date", () => {
    const r = compareSellingCosts({ sale_price: 100 }, { now: new Date("2027-03-01T00:00:00Z") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(r.result.warnings.join(" ")).toMatch(/out of date/i);
    }
  });
  it("does not warn when schedules are fresh", () => {
    const r = ok({ sale_price: 100 });
    expect(r.warnings.length).toBe(0);
  });
});

describe("compare_selling_costs: human summary is neutral", () => {
  it("labels eBay as estimated and avoids superiority claims", () => {
    const r = ok({ sale_price: 250 });
    const text = summarizeComparison(r).toLowerCase();
    expect(text).toContain("estimated");
    expect(text).toContain("disclaimer".length ? "not financial advice" : "");
    expect(text).not.toContain("cheapest");
    expect(text).not.toContain("best choice");
    expect(text).not.toContain("guaranteed");
  });
});
