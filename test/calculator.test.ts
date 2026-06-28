import { describe, it, expect } from "vitest";
import {
  computeMethod,
  getBinzPayout,
  platformFee,
  round2,
  type ComputeInput,
} from "../src/fees/calculator";
import { PULLTRADER_FEES } from "../src/fees/schedule";

const base: ComputeInput = {
  sale_price: 100,
  quantity: 1,
  shipping_amount: 0,
  seller_plan: "free",
  seller_covers_fees: false,
  ebay_store_subscription: false,
};

describe("round2", () => {
  it("rounds to cents", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(13.554999)).toBe(13.55);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("platformFee (3.25% + $0.40)", () => {
  it("computes variable + fixed", () => {
    expect(platformFee(100, PULLTRADER_FEES)).toBe(3.65);
  });
  it("supports excluding the fixed component", () => {
    expect(platformFee(100, PULLTRADER_FEES, false)).toBe(3.25);
  });
  it("returns 0 for non-positive base", () => {
    expect(platformFee(0, PULLTRADER_FEES)).toBe(0);
    expect(platformFee(-5, PULLTRADER_FEES)).toBe(0);
  });
});

describe("getBinzPayout", () => {
  it("returns fixed values at exact price points", () => {
    expect(getBinzPayout(0.05, PULLTRADER_FEES)).toBe(0.03);
    expect(getBinzPayout(0.25, PULLTRADER_FEES)).toBe(0.15);
    expect(getBinzPayout(1, PULLTRADER_FEES)).toBe(0.6);
    expect(getBinzPayout(10, PULLTRADER_FEES)).toBe(8.5);
  });
  it("applies range bands", () => {
    expect(getBinzPayout(2, PULLTRADER_FEES)).toBe(1.4); // 1<x<=3 -> x-0.60
    expect(getBinzPayout(4, PULLTRADER_FEES)).toBe(3.25); // 3<x<=5 -> x-0.75
    expect(getBinzPayout(7, PULLTRADER_FEES)).toBe(5.95); // 5<x<10 -> 85%
  });
  it("returns null when Binz does not apply", () => {
    expect(getBinzPayout(11, PULLTRADER_FEES)).toBeNull();
    expect(getBinzPayout(100, PULLTRADER_FEES)).toBeNull();
  });
});

describe("computeMethod: eBay (estimated)", () => {
  it("applies the individual 13.25% rate + $0.40 per-order fee on $100", () => {
    const r = computeMethod("ebay", base);
    expect(r.estimated).toBe(true);
    expect(r.estimated_total_fees).toBe(13.65); // 13.25 + 0.40 (order > $10)
    expect(r.estimated_payout).toBe(86.35);
    expect(r.effective_fee_rate).toBe(13.65);
  });
  it("uses the $0.30 per-order fee for orders <= $10", () => {
    const r = computeMethod("ebay", { ...base, sale_price: 5 });
    // 5 * 13.25% = 0.66 + 0.30 = 0.96
    expect(r.estimated_total_fees).toBe(0.96);
  });
  it("includes shipping in the fee base", () => {
    const r = computeMethod("ebay", { ...base, shipping_amount: 10 });
    // 110 * 13.25% = 14.58 + 0.40 = 14.98
    expect(r.estimated_total_fees).toBe(14.98);
  });
  it("applies the Store subscriber rate when set", () => {
    const r = computeMethod("ebay", { ...base, ebay_store_subscription: true });
    expect(r.estimated_total_fees).toBe(12.75); // 12.35 + 0.40
  });
  it("applies the second tier above the per-item threshold (individual)", () => {
    const r = computeMethod("ebay", { ...base, sale_price: 8000 });
    // 7500*13.25% + 500*2.35% = 993.75 + 11.75 = 1005.50, + 0.40
    expect(r.estimated_total_fees).toBe(1005.9);
  });
  it("applies the second tier above the Store threshold", () => {
    const r = computeMethod("ebay", { ...base, sale_price: 3000, ebay_store_subscription: true });
    // 2500*12.35% + 500*2.35% = 308.75 + 11.75 = 320.50, + 0.40
    expect(r.estimated_total_fees).toBe(320.9);
  });
  it("honors a user fee override (flat, tiers ignored) and notes it", () => {
    const r = computeMethod("ebay", { ...base, ebay_fee_percent_override: 10 });
    expect(r.estimated_total_fees).toBe(10.4); // 10.00 + 0.40
    expect(r.notes.some((n) => n.includes("supplied by the user"))).toBe(true);
  });
  it("treats all eBay fees as seller-borne", () => {
    const r = computeMethod("ebay", base);
    expect(r.fee_breakdown.every((c) => c.paid_by === "seller")).toBe(true);
  });
});

describe("computeMethod: Pulltrader marketplace", () => {
  it("free plan keeps 91%", () => {
    const r = computeMethod("pulltrader_marketplace", base);
    expect(r.estimated_payout).toBe(91);
    expect(r.estimated_total_fees).toBe(9);
  });
  it("shop plan keeps 95%", () => {
    const r = computeMethod("pulltrader_marketplace", { ...base, seller_plan: "shop" });
    expect(r.estimated_payout).toBe(95);
  });
  it("deducts platform fee when the seller covers it", () => {
    const r = computeMethod("pulltrader_marketplace", { ...base, seller_covers_fees: true });
    // 91 - (3.25% + 0.40 of 100 = 3.65) = 87.35
    expect(r.estimated_payout).toBe(87.35);
  });
  it("applies Binz for low prices", () => {
    const r = computeMethod("pulltrader_marketplace", { ...base, sale_price: 1 });
    expect(r.estimated_payout).toBe(0.6);
  });
  it("multiplies per-unit payout by quantity", () => {
    const r = computeMethod("pulltrader_marketplace", { ...base, sale_price: 50, quantity: 2 });
    expect(r.gross_amount).toBe(100);
    expect(r.estimated_payout).toBe(91);
  });
  it("always shows the platform fee, buyer-paid by default (not deducted from seller)", () => {
    const r = computeMethod("pulltrader_marketplace", base);
    const platform = r.fee_breakdown.find((c) => c.label.includes("Platform fee"));
    expect(platform).toBeDefined();
    expect(platform!.amount).toBe(3.65);
    expect(platform!.paid_by).toBe("buyer");
    expect(r.estimated_payout).toBe(91); // unaffected by buyer-paid platform fee
  });
  it("labels the commission as a seller fee", () => {
    const r = computeMethod("pulltrader_marketplace", base);
    const sellerFee = r.fee_breakdown.find((c) => c.label.toLowerCase().includes("seller fee"));
    expect(sellerFee?.amount).toBe(9);
    expect(sellerFee?.paid_by).toBe("seller");
  });
});

describe("computeMethod: storefront / POS", () => {
  it("has no seller fee and keeps 100% when the buyer pays the platform fee (default)", () => {
    const r = computeMethod("pulltrader_storefront", base);
    expect(r.estimated_payout).toBe(100);
    expect(r.estimated_total_fees).toBe(0);
    // No seller-fee/commission line; platform fee present but buyer-paid.
    expect(r.fee_breakdown.some((c) => c.label.toLowerCase().includes("seller fee"))).toBe(false);
    const platform = r.fee_breakdown.find((c) => c.label.includes("Platform fee"));
    expect(platform?.paid_by).toBe("buyer");
    expect(platform?.amount).toBe(3.65);
  });
  it("deducts only the platform fee when the seller covers it", () => {
    const r = computeMethod("pulltrader_storefront", { ...base, seller_covers_fees: true });
    expect(r.estimated_payout).toBe(96.35);
  });
  it("POS notes cash sales are fee-free", () => {
    const r = computeMethod("pulltrader_pos", base);
    expect(r.notes.some((n) => n.toLowerCase().includes("cash"))).toBe(true);
  });
});

describe("computeMethod: competitor marketplaces (estimated)", () => {
  it("TCGplayer: 10.75% commission + 2.5% + $0.30 processing", () => {
    const r = computeMethod("tcgplayer", base);
    expect(r.estimated).toBe(true);
    // 10.75 commission + (100*2.5% + 0.30 = 2.80) = 13.55
    expect(r.estimated_total_fees).toBe(13.55);
    expect(r.estimated_payout).toBe(86.45);
    expect(r.where_it_sells).toBe("TCGplayer");
    expect(r.fee_breakdown.every((c) => c.paid_by === "seller")).toBe(true);
  });
  it("TCGplayer: commission is capped at $75 per item", () => {
    const r = computeMethod("tcgplayer", { ...base, sale_price: 2000 });
    // commission capped 75; processing 2000*2.5% + 0.30 = 50.30 -> fees 125.30
    expect(r.estimated_total_fees).toBe(125.3);
    expect(r.estimated_payout).toBe(1874.7);
  });
  it("Mana Pool: 5% on item only + 2.9% + $0.30 on the whole order", () => {
    const r = computeMethod("manapool", { ...base, shipping_amount: 10 });
    // commission 5 (item only); processing 110*2.9% + 0.30 = 3.49; fees 8.49
    expect(r.estimated_total_fees).toBe(8.49);
    expect(r.estimated_payout).toBe(101.51);
  });
  it("Misprint: 7% + 3% + $0.30, both on item + shipping", () => {
    const r = computeMethod("misprint", { ...base, shipping_amount: 10 });
    // commission 110*7% = 7.70; processing 110*3% + 0.30 = 3.60; fees 11.30
    expect(r.estimated_total_fees).toBe(11.3);
    expect(r.estimated_payout).toBe(98.7);
  });
  it("Fanatics Collect: flat 6% Buy Now, no separate processing", () => {
    const r = computeMethod("fanatics_collect", base);
    expect(r.estimated_total_fees).toBe(6);
    expect(r.estimated_payout).toBe(94);
    expect(r.fee_breakdown).toHaveLength(1);
  });
  it("Goldin: tiered commission selects the right band by price", () => {
    expect(computeMethod("goldin", { ...base, sale_price: 100 }).estimated_total_fees).toBe(16.7);
    expect(computeMethod("goldin", { ...base, sale_price: 2499.99 }).effective_fee_rate).toBe(16.7);
    expect(computeMethod("goldin", { ...base, sale_price: 2500 }).estimated_total_fees).toBe(312.5); // 12.5%
    expect(computeMethod("goldin", { ...base, sale_price: 7000 }).estimated_total_fees).toBe(700); // 10%
    expect(computeMethod("goldin", { ...base, sale_price: 50000 }).estimated_total_fees).toBe(4150); // 8.3%
    expect(computeMethod("goldin", { ...base, sale_price: 300000 }).estimated_total_fees).toBe(24900); // last tier 8.3%
  });
  it("supports net profit from acquisition cost", () => {
    const r = computeMethod("fanatics_collect", { ...base, acquisition_cost: 40 });
    expect(r.estimated_net_profit).toBe(54);
  });
});

describe("computeMethod: FBP and net profit", () => {
  it("FBP payout matches marketplace and notes fulfillment exclusions", () => {
    const mk = computeMethod("pulltrader_marketplace", base);
    const fbp = computeMethod("pulltrader_fbp", base);
    expect(fbp.estimated_payout).toBe(mk.estimated_payout);
    expect(fbp.fulfilled_by).toBe("pulltrader");
    expect(fbp.notes.some((n) => n.toLowerCase().includes("fulfilled by pulltrader"))).toBe(true);
  });
  it("computes net profit from acquisition cost", () => {
    const r = computeMethod("pulltrader_marketplace", { ...base, acquisition_cost: 40 });
    expect(r.estimated_net_profit).toBe(51);
  });
});
