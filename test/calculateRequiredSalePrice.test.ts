import { describe, it, expect } from "vitest";
import { calculateRequiredSalePrice } from "../src/tools/calculateRequiredSalePrice";
import { computeMethod, type ComputeInput } from "../src/fees/calculator";

const now = new Date("2026-06-27T12:00:00Z");

describe("calculate_required_sale_price: validation", () => {
  it("requires target_net", () => {
    const out = calculateRequiredSalePrice({}, { now });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("INVALID_INPUT");
  });
  it("rejects non-positive target_net", () => {
    const out = calculateRequiredSalePrice({ target_net: 0 }, { now });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.field).toBe("target_net");
  });
  it("rejects an unsupported method", () => {
    const out = calculateRequiredSalePrice({ target_net: 10, method: "craigslist" }, { now });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UNSUPPORTED_SELLING_METHOD");
  });
  it("defaults method to ebay", () => {
    const out = calculateRequiredSalePrice({ target_net: 50 }, { now });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.method).toBe("ebay");
  });
});

describe("calculate_required_sale_price: storefront (no seller fee, buyer pays platform)", () => {
  it("equals the target since the seller keeps the full item price by default", () => {
    const out = calculateRequiredSalePrice(
      { target_net: 80, method: "pulltrader_storefront" },
      { now },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Buyer pays the platform fee, so payout == price; required price ~= target
    // (bisection lands within $0.01 of the boundary).
    expect(out.result.required_sale_price).toBeCloseTo(80, 1);
    expect(out.result.achieved_net).toBeCloseTo(80, 1);
    expect(out.result.net_basis).toBe("take_home_payout");
  });
});

describe("calculate_required_sale_price: round-trips against compute", () => {
  it("the solved price reproduces (>=) the target net when fed back through the engine", () => {
    const target = 120;
    const out = calculateRequiredSalePrice(
      { target_net: target, method: "ebay", shipping_amount: 0 },
      { now },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const price = out.result.required_sale_price!;
    const input: ComputeInput = {
      sale_price: price,
      quantity: 1,
      shipping_amount: 0,
      seller_plan: "free",
      seller_covers_fees: false,
      ebay_store_subscription: false,
    };
    const r = computeMethod("ebay", input);
    expect(r.estimated_payout).toBeGreaterThanOrEqual(target - 0.05);
    // Should not massively overshoot (within ~$1 of target given $0.01 tolerance).
    expect(r.estimated_payout).toBeLessThan(target + 1);
  });
});

describe("calculate_required_sale_price: net profit basis", () => {
  it("treats target_net as profit when acquisition_cost is supplied", () => {
    const out = calculateRequiredSalePrice(
      { target_net: 20, method: "pulltrader_storefront", acquisition_cost: 30 },
      { now },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.net_basis).toBe("net_profit_after_acquisition_cost");
    // payout == price; profit = price - 30 = 20 => price ~= 50.
    expect(out.result.required_sale_price).toBeCloseTo(50, 1);
    expect(out.result.achieved_net).toBeCloseTo(20, 1);
  });
});
