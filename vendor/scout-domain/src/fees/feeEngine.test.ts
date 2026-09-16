import { describe, it, expect } from "vitest";
import {
  computeMethod,
  compareSellingMethods,
  requiredSalePriceForNet,
  getBinzPayout,
  marketplacePayout,
  externalPayout,
  storefrontPayout,
  resolveSellerRate,
  type ComputeInput,
  type SellingMethod,
} from "./feeEngine";
import {
  PULLTRADER_FEES,
  PLAN_TO_SELLER_LEVEL,
  SELLER_LEVEL_RATES,
  type SellerLevel,
  type SellerPlan,
} from "./schedule";

// ---------------------------------------------------------------------------
// Legacy payout oracle — copied from pulltrader-backend/utils/payoutCalculator.js
// ---------------------------------------------------------------------------

const LEGACY_SELLER_LEVEL_RATES: Record<number, number> = { 1: 91, 2: 92, 3: 93, 4: 94, 5: 95 };
const EXTERNAL_RATE = 85;
const FIXED_PAYOUT_VALUES: Record<string, number> = {
  "0.05": 0.03,
  "0.1": 0.06,
  "0.25": 0.15,
  "0.5": 0.3,
  "1": 0.6,
  "3": 2.4,
  "5": 4.25,
  "10": 8.5,
};

function legacyGetBinzPayout(price: number): number | null {
  const rounded = Math.round(price * 100) / 100;
  const key = String(rounded);
  if (Object.prototype.hasOwnProperty.call(FIXED_PAYOUT_VALUES, key)) return FIXED_PAYOUT_VALUES[key]!;
  if (rounded > 1 && rounded <= 3) return Math.round((rounded - 0.6) * 100) / 100;
  if (rounded > 3 && rounded <= 5) return Math.round((rounded - 0.75) * 100) / 100;
  if (rounded > 5 && rounded < 10) return Math.round(rounded * 0.85 * 100) / 100;
  return null;
}

// platform path of calculatePayoutForItem (coversFees=false default)
function legacyMarketplacePayout(price: number, level: number): number {
  const binz = legacyGetBinzPayout(price);
  if (binz !== null) return binz;
  const rate = LEGACY_SELLER_LEVEL_RATES[level] ?? 91;
  const payout = price * (rate / 100);
  return Math.round(payout * 100) / 100;
}

// external path of calculatePayoutForSale (rounds)
function legacyExternalPayout(price: number): number {
  const binz = legacyGetBinzPayout(price);
  if (binz !== null) return binz;
  const payout = price * (EXTERNAL_RATE / 100);
  return Math.max(0, Math.round(payout * 100) / 100);
}

// calculateStorefrontPayout
function legacyStorefrontPayout(price: number, coversFees: boolean, shipping = 0, tax = 0): number {
  if (!coversFees) return Math.round(price * 100) / 100;
  const orderTotal = price + shipping + tax;
  const fee = Math.round((orderTotal * (3.25 / 100) + 0.4) * 100) / 100;
  return Math.max(0, Math.round((price - fee) * 100) / 100);
}

const PRICES = [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4.99, 5, 7.5, 9.99, 10, 12, 27.5, 100, 250.75, 3105, 99999];
const PLANS: SellerPlan[] = ["free", "operations", "business", "managed"];

describe("FeeEngine payout parity with backend payoutCalculator.js", () => {
  it("getBinzPayout matches legacy exactly", () => {
    for (const p of PRICES) {
      expect(getBinzPayout(p)).toBe(legacyGetBinzPayout(p));
    }
  });

  it("marketplacePayout matches legacy platform payout for every plan", () => {
    for (const plan of PLANS) {
      const level = PLAN_TO_SELLER_LEVEL[plan];
      for (const p of PRICES) {
        expect(marketplacePayout(p, plan)).toBeCloseTo(legacyMarketplacePayout(p, level), 2);
      }
    }
  });

  it("externalPayout matches legacy 85% external payout (Binz first)", () => {
    for (const p of PRICES) {
      expect(externalPayout(p)).toBeCloseTo(legacyExternalPayout(p), 2);
    }
  });

  it("storefrontPayout matches legacy storefront payout (no Binz)", () => {
    for (const p of PRICES) {
      expect(storefrontPayout(p, { coversFees: false })).toBeCloseTo(legacyStorefrontPayout(p, false), 2);
      expect(storefrontPayout(p, { coversFees: true, shipping: 4.99 })).toBeCloseTo(
        legacyStorefrontPayout(p, true, 4.99),
        2,
      );
    }
  });
});

describe("FeeEngine MCP comparison golden values", () => {
  const base: Omit<ComputeInput, "sale_price"> = {
    quantity: 1,
    shipping_amount: 0,
    seller_plan: "free",
    seller_covers_fees: false,
    ebay_store_subscription: false,
  };

  it("computes eBay individual fees for a $100 sale", () => {
    const r = computeMethod("ebay", { ...base, sale_price: 100 });
    expect(r.estimated_total_fees).toBe(13.65); // 13.25 FVF + 0.40 per-order
    expect(r.estimated_payout).toBe(86.35);
    expect(r.effective_fee_rate).toBe(13.65);
    expect(r.estimated).toBe(true);
  });

  it("free-plan marketplace keeps 91% (buyer pays platform fee)", () => {
    const r = computeMethod("pulltrader_marketplace", { ...base, sale_price: 100 });
    expect(r.estimated_payout).toBe(91);
    expect(r.estimated_total_fees).toBe(9);
  });

  it("storefront keeps 100% when buyer covers the platform fee", () => {
    const r = computeMethod("pulltrader_storefront", { ...base, sale_price: 100 });
    expect(r.estimated_payout).toBe(100);
    expect(r.estimated_total_fees).toBe(0);
  });

  it("compares methods, baselines on eBay, picks the best for the seller", () => {
    const cmp = compareSellingMethods(
      { ...base, sale_price: 100 },
      ["ebay", "pulltrader_marketplace", "pulltrader_storefront"],
    );
    expect(cmp.baseline_method).toBe("ebay");
    expect(cmp.best_for_seller).toBe("pulltrader_storefront");
    const deltas = Object.fromEntries(
      cmp.difference_from_baseline.map((d) => [d.method, d.delta_vs_baseline]),
    );
    expect(deltas["ebay"]).toBe(0);
    expect(deltas["pulltrader_marketplace"]).toBe(4.65);
    expect(deltas["pulltrader_storefront"]).toBe(13.65);
  });

  it("applies the eBay fee override (flat rate, tiers ignored)", () => {
    const r = computeMethod("ebay", { ...base, sale_price: 100, ebay_fee_percent_override: 10 });
    expect(r.estimated_total_fees).toBe(10.4); // 10% + 0.40
    expect(r.estimated_payout).toBe(89.6);
  });

  it("computes a competitor (TCGplayer) result with processing fee", () => {
    const r = computeMethod("tcgplayer", { ...base, sale_price: 100 });
    expect(r.estimated).toBe(true);
    expect(r.where_it_sells).toBe("TCGplayer");
    // 10.75 commission (on item) + 2.80 processing (2.5% of $100 + $0.30)
    expect(r.estimated_total_fees).toBe(13.55);
    expect(r.estimated_payout).toBe(86.45);
  });
});

describe("requiredSalePriceForNet inverse solver", () => {
  const base: Omit<ComputeInput, "sale_price"> = {
    quantity: 1,
    shipping_amount: 0,
    seller_plan: "free",
    seller_covers_fees: false,
    ebay_store_subscription: false,
  };

  it("finds the eBay price needed to net a target", () => {
    const res = requiredSalePriceForNet("ebay", 200, base);
    expect(res.converged).toBe(true);
    expect(res.required_sale_price).not.toBeNull();
    // achieved net should be at least the target (engine rounds in seller's favor by <= 1 cent of tolerance)
    expect(res.achieved_net!).toBeGreaterThanOrEqual(200 - 0.02);
    // sanity: recomputing at the solved price nets ~target
    const check = computeMethod("ebay", { ...base, sale_price: res.required_sale_price! });
    expect(check.estimated_payout).toBeGreaterThanOrEqual(200 - 0.02);
  });

  it("returns null when the target is unreachable within bounds", () => {
    const res = requiredSalePriceForNet("ebay", 10_000_000, base, { maxPrice: 1000 });
    expect(res.converged).toBe(false);
    expect(res.required_sale_price).toBeNull();
  });
});

describe("schedule sanity", () => {
  it("exposes the authoritative Pulltrader seller rates", () => {
    expect(PULLTRADER_FEES.seller_level_rates).toEqual({ free: 91, operations: 91, business: 95, managed: 95 });
  });

  it("exposes every seller level, including the revenue-only ones", () => {
    expect(PULLTRADER_FEES.level_rates).toEqual({ 1: 91, 2: 92, 3: 93, 4: 94, 5: 95 });
  });

  it("the plan floors agree with the level table", () => {
    for (const [plan, rate] of Object.entries(PULLTRADER_FEES.seller_level_rates)) {
      const level = PLAN_TO_SELLER_LEVEL[plan as SellerPlan];
      expect(rate).toBe(SELLER_LEVEL_RATES[level as SellerLevel]);
    }
  });
});

describe("seller level modelling", () => {
  const LEVELS: SellerLevel[] = [1, 2, 3, 4, 5];

  it("an explicit level overrides the plan floor", () => {
    for (const level of LEVELS) {
      expect(resolveSellerRate("free", level)).toBe(SELLER_LEVEL_RATES[level]);
    }
    // A free seller who earned level 4 keeps 94%, not the plan's 91%.
    expect(resolveSellerRate("free", 4)).toBe(94);
    expect(resolveSellerRate("free", undefined)).toBe(91);
  });

  it("falls back to the plan when no level is given", () => {
    for (const plan of PLANS) {
      expect(resolveSellerRate(plan, undefined)).toBe(
        PULLTRADER_FEES.seller_level_rates[plan],
      );
    }
  });

  it("levels 2 and 4 are reachable, which no plan can express", () => {
    const planRates = new Set(Object.values(PULLTRADER_FEES.seller_level_rates));
    expect(planRates.has(92)).toBe(false);
    expect(planRates.has(94)).toBe(false);
    expect(resolveSellerRate("free", 2)).toBe(92);
    expect(resolveSellerRate("free", 4)).toBe(94);
  });

  it("computeMethod pays out at the explicit level", () => {
    const base: ComputeInput = {
      sale_price: 100,
      quantity: 1,
      shipping_amount: 0,
      seller_plan: "free",
      seller_covers_fees: false,
      ebay_store_subscription: false,
    };
    for (const level of LEVELS) {
      const r = computeMethod("pulltrader_marketplace", { ...base, seller_level: level });
      expect(r.estimated_payout).toBe(SELLER_LEVEL_RATES[level]);
    }
    // Unchanged when no level is supplied.
    expect(computeMethod("pulltrader_marketplace", base).estimated_payout).toBe(91);
  });

  it("names the seller level in the fee breakdown when one is given", () => {
    const base: ComputeInput = {
      sale_price: 100,
      quantity: 1,
      shipping_amount: 0,
      seller_plan: "free",
      seller_covers_fees: false,
      ebay_store_subscription: false,
    };
    const withLevel = computeMethod("pulltrader_marketplace", { ...base, seller_level: 4 });
    expect(withLevel.fee_breakdown[0]?.label).toContain("seller level 4 keeps 94%");

    const withoutLevel = computeMethod("pulltrader_marketplace", base);
    expect(withoutLevel.fee_breakdown[0]?.label).toContain("free plan keeps 91%");
  });
});
