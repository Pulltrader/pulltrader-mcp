// =============================================================================
// CANONICAL SELLER-ECONOMICS FEE ENGINE
// =============================================================================
// Pure functions. No I/O, no clock, no randomness -> identical inputs always
// produce identical outputs.
//
// This is the consolidation of two engines that must agree to the cent:
//   - cloudflare-workers/pulltrader-mcp/src/fees/calculator.ts (compare_selling_costs)
//   - pulltrader-backend/utils/payoutCalculator.js             (real settlement payouts)
//
// `computeMethod` / `compareSellingMethods` reproduce the MCP engine.
// The payout adapters (`marketplacePayout`, `externalPayout`, `storefrontPayout`,
// `getBinzPayout`) reproduce the backend payout math. feeEngine.test.ts locks
// parity with both so either consumer can adopt this without behavior change.
// =============================================================================

import { round2 } from "../money";
import {
  COMPETITOR_FEES,
  EBAY_FEES,
  PULLTRADER_FEES,
  type CompetitorFeeSchedule,
  type CompetitorMethod,
  type EbayFeeSchedule,
  type PulltraderFeeSchedule,
  type SellerPlan,
  type SellerLevel,
} from "./schedule";

export { round2 } from "../money";

export type SellingMethod =
  | "ebay"
  | "pulltrader_marketplace"
  | "pulltrader_fbp"
  | "pulltrader_storefront"
  | "pulltrader_pos"
  | CompetitorMethod;

export const SUPPORTED_METHODS: SellingMethod[] = [
  "ebay",
  "pulltrader_marketplace",
  "pulltrader_fbp",
  "pulltrader_storefront",
  "pulltrader_pos",
  "tcgplayer",
  "manapool",
  "misprint",
  "fanatics_collect",
  "goldin",
];

export const COMPETITOR_METHODS: CompetitorMethod[] = [
  "tcgplayer",
  "manapool",
  "misprint",
  "fanatics_collect",
  "goldin",
];

export const DEFAULT_METHODS: SellingMethod[] = [
  "ebay",
  "pulltrader_marketplace",
  "pulltrader_storefront",
];

export interface FeeComponent {
  label: string;
  amount: number;
  kind: "percentage" | "fixed";
  paid_by: "seller" | "buyer";
}

export interface MethodResult {
  method: SellingMethod;
  label: string;
  gross_amount: number;
  estimated_total_fees: number;
  fee_breakdown: FeeComponent[];
  estimated_payout: number;
  effective_fee_rate: number;
  estimated_net_profit?: number;
  owns_listing: "seller" | "pulltrader";
  fulfilled_by: "seller" | "pulltrader";
  where_it_sells: string;
  estimated: boolean;
  notes: string[];
}

export interface ComputeInput {
  sale_price: number;
  quantity: number;
  shipping_amount: number;
  seller_plan: SellerPlan;
  /**
   * The seller's actual level (1-5), when known. Level is set from plan AND
   * revenue, so a seller can be above what their plan grants on its own —
   * levels 2 and 4 are only reachable this way. Falls back to the plan's rate.
   */
  seller_level?: SellerLevel;
  seller_covers_fees: boolean;
  ebay_store_subscription: boolean;
  acquisition_cost?: number;
  ebay_fee_percent_override?: number;
  ebaySchedule?: EbayFeeSchedule;
  pulltraderSchedule?: PulltraderFeeSchedule;
}

// ---------------------------------------------------------------------------
// Primitive fee helpers (shared by the MCP engine and the backend payout math)
// ---------------------------------------------------------------------------

/** Binz fixed payout for a single item price, else null. Matches both engines. */
export function getBinzPayout(
  price: number,
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): number | null {
  const rounded = round2(price);
  const key = String(rounded);
  if (Object.prototype.hasOwnProperty.call(schedule.binz_fixed, key)) {
    return schedule.binz_fixed[key] ?? null;
  }
  if (rounded > 1 && rounded <= 3) return round2(rounded - 0.6);
  if (rounded > 3 && rounded <= 5) return round2(rounded - 0.75);
  if (rounded > 5 && rounded < 10) return round2(rounded * 0.85);
  return null;
}

/** Platform fee: percent of base + fixed (applied once per order by default). */
export function platformFee(
  baseDollars: number,
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
  includeFixed = true,
): number {
  if (baseDollars <= 0) return 0;
  const variable = round2(baseDollars * (schedule.platform_fee_percent / 100));
  return round2(variable + (includeFixed ? schedule.platform_fee_fixed : 0));
}

/** eBay final value fee for a single item's sale amount (item + shipping). */
export function ebayFvfPerItem(
  itemSaleAmount: number,
  tier: EbayFeeSchedule["individual"],
  overridePercent?: number,
): number {
  if (overridePercent !== undefined) {
    return round2(itemSaleAmount * (overridePercent / 100));
  }
  if (itemSaleAmount <= tier.threshold) {
    return round2(itemSaleAmount * (tier.rate_percent / 100));
  }
  const base = tier.threshold * (tier.rate_percent / 100);
  const over = (itemSaleAmount - tier.threshold) * (tier.over_threshold_percent / 100);
  return round2(base + over);
}

/**
 * The payout rate to apply: an explicit seller level wins, otherwise the rate
 * the plan grants on its own.
 */
export function resolveSellerRate(
  plan: SellerPlan,
  level: SellerLevel | undefined,
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): number {
  return level != null ? schedule.level_rates[level] : schedule.seller_level_rates[plan];
}

function marketplaceUnitPayout(
  unitPrice: number,
  plan: SellerPlan,
  schedule: PulltraderFeeSchedule,
  level?: SellerLevel,
): number {
  const binz = getBinzPayout(unitPrice, schedule);
  if (binz !== null) return binz;
  return round2(unitPrice * (resolveSellerRate(plan, level, schedule) / 100));
}

function ratePct(fees: number, gross: number): number {
  if (gross <= 0) return 0;
  return round2((fees / gross) * 100);
}

// ---------------------------------------------------------------------------
// Backend payout adapters (reproduce pulltrader-backend/utils/payoutCalculator.js)
// ---------------------------------------------------------------------------

/**
 * Per-item Pulltrader marketplace payout for a seller plan. Binz pricing applies
 * first, then the plan's seller-level percentage. Mirrors
 * payoutCalculator.calculatePayoutForItem (platform path).
 */
export function marketplacePayout(
  price: number,
  plan: SellerPlan,
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): number {
  return marketplaceUnitPayout(price, plan, schedule);
}

/**
 * External (eBay / off-platform) payout: flat 85%, no per-item fee, Binz first.
 * Mirrors payoutCalculator.calculatePayoutForItem (external path).
 */
export function externalPayout(
  price: number,
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): number {
  const binz = getBinzPayout(price, schedule);
  if (binz !== null) return binz;
  return Math.max(0, round2(price * (schedule.external_rate_percent / 100)));
}

/**
 * Storefront / POS payout. No marketplace commission and NO Binz; the buyer pays
 * the platform fee by default, so the seller keeps the full item price unless
 * they cover the fee. Mirrors payoutCalculator.calculateStorefrontPayout.
 */
export function storefrontPayout(
  price: number,
  opts: { coversFees?: boolean; shipping?: number; tax?: number; includePlatformFeeFixed?: boolean } = {},
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): number {
  const { coversFees = false, shipping = 0, tax = 0, includePlatformFeeFixed = true } = opts;
  if (!coversFees) return round2(price);
  const orderTotal = price + shipping + tax;
  const fee = platformFee(orderTotal, schedule, includePlatformFeeFixed);
  return Math.max(0, round2(price - fee));
}

// ---------------------------------------------------------------------------
// MCP comparison engine
// ---------------------------------------------------------------------------

export function competitorCommissionPerItem(
  commissionBaseAmount: number,
  schedule: CompetitorFeeSchedule,
): number {
  let rate: number;
  if (schedule.commission_tiers && schedule.commission_tiers.length > 0) {
    const tier =
      schedule.commission_tiers.find((t) => t.up_to === null || commissionBaseAmount <= t.up_to) ??
      schedule.commission_tiers[schedule.commission_tiers.length - 1]!;
    rate = tier.rate_percent;
  } else {
    rate = schedule.commission_percent ?? 0;
  }
  let commission = commissionBaseAmount * (rate / 100);
  if (schedule.commission_cap_per_item !== null) {
    commission = Math.min(commission, schedule.commission_cap_per_item);
  }
  return round2(commission);
}

export function computeCompetitor(
  method: CompetitorMethod,
  input: ComputeInput,
  schedule: CompetitorFeeSchedule,
): MethodResult {
  const qty = input.quantity;
  const unit = input.sale_price;
  const shipping = input.shipping_amount;
  const gross = round2(unit * qty);
  const orderTotal = round2(gross + shipping);
  const perUnitShipping = qty > 0 ? shipping / qty : 0;

  const commissionItemBase =
    schedule.commission_base === "item_plus_shipping" ? round2(unit + perUnitShipping) : unit;
  const commissionTotal = round2(competitorCommissionPerItem(commissionItemBase, schedule) * qty);

  let processing = 0;
  if (schedule.processing_base !== "none") {
    const pbase = schedule.processing_base === "item_plus_shipping" ? orderTotal : gross;
    processing = round2(pbase * (schedule.processing_percent / 100) + schedule.processing_fixed);
  }

  const fees = round2(commissionTotal + processing);
  const payout = round2(gross + shipping - fees);

  const breakdown: FeeComponent[] = [
    {
      label: schedule.commission_tiers
        ? `${schedule.where_it_sells} seller commission (tiered by price)`
        : `${schedule.where_it_sells} seller fee (${schedule.commission_percent}%${
            schedule.commission_cap_per_item !== null
              ? `, capped $${schedule.commission_cap_per_item}/item`
              : ""
          })`,
      amount: commissionTotal,
      kind: "percentage",
      paid_by: "seller",
    },
  ];
  if (processing > 0) {
    breakdown.push({
      label: `Payment processing (${schedule.processing_percent}% + $${schedule.processing_fixed.toFixed(2)})`,
      amount: processing,
      kind: "fixed",
      paid_by: "seller",
    });
  }

  const notes: string[] = [
    `Estimated ${schedule.where_it_sells} fixed-price seller fees. ${schedule.category_note}`,
    ...schedule.conditional_notes,
    "Excludes the seller's own shipping-label cost.",
  ];

  return {
    method,
    label: schedule.label,
    gross_amount: gross,
    estimated_total_fees: fees,
    fee_breakdown: breakdown,
    estimated_payout: payout,
    effective_fee_rate: ratePct(fees, orderTotal),
    owns_listing: "seller",
    fulfilled_by: "seller",
    where_it_sells: schedule.where_it_sells,
    estimated: true,
    notes,
  };
}

export function computeMethod(method: SellingMethod, input: ComputeInput): MethodResult {
  const pt = input.pulltraderSchedule ?? PULLTRADER_FEES;
  const ebay = input.ebaySchedule ?? EBAY_FEES;
  const qty = input.quantity;
  const unit = input.sale_price;
  const shipping = input.shipping_amount;
  const gross = round2(unit * qty);

  const competitorSchedule = (COMPETITOR_FEES as Record<string, CompetitorFeeSchedule | undefined>)[
    method
  ];
  if (competitorSchedule) {
    const result = computeCompetitor(method as CompetitorMethod, input, competitorSchedule);
    if (input.acquisition_cost !== undefined) {
      result.estimated_net_profit = round2(result.estimated_payout - input.acquisition_cost);
    }
    return result;
  }

  let result: MethodResult;

  switch (method) {
    case "ebay": {
      const override = input.ebay_fee_percent_override;
      const tier = input.ebay_store_subscription ? ebay.store : ebay.individual;
      const perUnitShipping = qty > 0 ? shipping / qty : 0;
      const perUnitSale = round2(unit + perUnitShipping);
      const fvf = round2(ebayFvfPerItem(perUnitSale, tier, override) * qty);
      const orderTotal = round2(gross + shipping);
      const perOrderFee =
        orderTotal <= ebay.per_order_fee_threshold ? ebay.per_order_fee_low : ebay.per_order_fee_high;
      const fees = round2(fvf + perOrderFee);
      const payout = round2(gross + shipping - fees);

      const fvfLabel =
        override !== undefined
          ? `eBay final value fee (${override}% of item + shipping, user-supplied)`
          : `eBay final value fee (${tier.rate_percent}% of item + shipping${
              input.ebay_store_subscription ? ", Store subscriber" : ""
            })`;
      const notes: string[] = [];
      if (override !== undefined)
        notes.push("eBay fee percentage was supplied by the user (flat rate, tiers ignored).");
      else if (input.ebay_store_subscription)
        notes.push(
          `Estimated using the eBay Store subscriber rate (${tier.rate_percent}% up to $${tier.threshold} per item, ${tier.over_threshold_percent}% above).`,
        );
      else
        notes.push(
          `Estimated using the individual (no Store subscription) rate (${tier.rate_percent}% up to $${tier.threshold} per item, ${tier.over_threshold_percent}% above).`,
        );
      notes.push(
        `Per-order fee is $${ebay.per_order_fee_low.toFixed(2)} for orders \u2264 $${ebay.per_order_fee_threshold.toFixed(2)}, otherwise $${ebay.per_order_fee_high.toFixed(2)}.`,
      );
      notes.push(
        "Excludes promoted listings, international fees, sales tax, and your own shipping-label cost.",
      );

      result = {
        method,
        label: "Sell it yourself on eBay",
        gross_amount: gross,
        estimated_total_fees: fees,
        fee_breakdown: [
          { label: fvfLabel, amount: fvf, kind: "percentage", paid_by: "seller" },
          {
            label: `eBay per-order fee (order total $${orderTotal.toFixed(2)})`,
            amount: round2(perOrderFee),
            kind: "fixed",
            paid_by: "seller",
          },
        ],
        estimated_payout: payout,
        effective_fee_rate: ratePct(fees, orderTotal),
        owns_listing: "seller",
        fulfilled_by: "seller",
        where_it_sells: "eBay",
        estimated: true,
        notes,
      };
      break;
    }

    case "pulltrader_marketplace":
    case "pulltrader_fbp": {
      const isFbp = method === "pulltrader_fbp";
      const sellerFeePayout = round2(
        marketplaceUnitPayout(unit, input.seller_plan, pt, input.seller_level) * qty,
      );
      const keepPct = resolveSellerRate(input.seller_plan, input.seller_level, pt);
      let payout = sellerFeePayout;
      const breakdown: FeeComponent[] = [];
      const sellerFee = round2(gross - sellerFeePayout);
      breakdown.push({
        label: input.seller_level != null
          ? `Pulltrader seller fee (seller level ${input.seller_level} keeps ${keepPct}% of the item)`
          : `Pulltrader seller fee (${input.seller_plan} plan keeps ${keepPct}% of the item)`,
        amount: sellerFee,
        kind: "percentage",
        paid_by: "seller",
      });
      const platform = platformFee(round2(gross + shipping), pt);
      const platformPaidBy: "seller" | "buyer" = input.seller_covers_fees ? "seller" : "buyer";
      if (input.seller_covers_fees) payout = round2(Math.max(0, payout - platform));
      breakdown.push({
        label: `Platform fee (${pt.platform_fee_percent}% + $${pt.platform_fee_fixed.toFixed(2)}), paid by ${platformPaidBy}`,
        amount: platform,
        kind: "fixed",
        paid_by: platformPaidBy,
      });
      const notes: string[] = [
        "Binz fixed pricing is applied automatically for qualifying low item prices.",
      ];
      if (!input.seller_covers_fees) {
        notes.push(
          "The platform fee is always charged; by default the buyer pays it at checkout, so it is not deducted from the seller.",
        );
      }
      if (isFbp) {
        notes.push(
          "Fulfilled by Pulltrader: payout matches the marketplace tier; fulfillment, storage, and label costs are not modeled here.",
        );
      }
      const fees = round2(gross - payout);
      result = {
        method,
        label: isFbp
          ? "Pulltrader marketplace (Fulfilled by Pulltrader)"
          : "Pulltrader marketplace (you ship)",
        gross_amount: gross,
        estimated_total_fees: fees,
        fee_breakdown: breakdown,
        estimated_payout: payout,
        effective_fee_rate: ratePct(fees, gross),
        owns_listing: "pulltrader",
        fulfilled_by: isFbp ? "pulltrader" : "seller",
        where_it_sells: "Pulltrader marketplace",
        estimated: false,
        notes,
      };
      break;
    }

    case "pulltrader_storefront":
    case "pulltrader_pos": {
      const isPos = method === "pulltrader_pos";
      const breakdown: FeeComponent[] = [];
      const notes: string[] = [
        "No Pulltrader seller fee on storefront or POS sales — the seller keeps the full item price.",
      ];
      const platform = platformFee(round2(gross + shipping), pt);
      const platformPaidBy: "seller" | "buyer" = input.seller_covers_fees ? "seller" : "buyer";
      const payout = input.seller_covers_fees ? round2(Math.max(0, gross - platform)) : gross;
      breakdown.push({
        label: `Platform fee (${pt.platform_fee_percent}% + $${pt.platform_fee_fixed.toFixed(2)}), paid by ${platformPaidBy}`,
        amount: platform,
        kind: "fixed",
        paid_by: platformPaidBy,
      });
      if (!input.seller_covers_fees) {
        notes.push("The platform fee is always charged; by default the buyer pays it at checkout.");
      }
      if (isPos) notes.push("Cash POS sales incur no Pulltrader fees at all (seller keeps 100%).");
      const fees = round2(gross - payout);
      result = {
        method,
        label: isPos ? "Pulltrader in-person POS (card)" : "Your Pulltrader storefront (you ship)",
        gross_amount: gross,
        estimated_total_fees: fees,
        fee_breakdown: breakdown,
        estimated_payout: payout,
        effective_fee_rate: ratePct(fees, gross),
        owns_listing: "seller",
        fulfilled_by: "seller",
        where_it_sells: isPos ? "In person (POS)" : "Your branded Pulltrader storefront",
        estimated: false,
        notes,
      };
      break;
    }

    default:
      throw new Error(`Unsupported method: ${String(method)}`);
  }

  if (input.acquisition_cost !== undefined) {
    result.estimated_net_profit = round2(result.estimated_payout - input.acquisition_cost);
  }
  return result;
}

export interface CompareDifference {
  method: SellingMethod;
  delta_vs_baseline: number;
}

export interface CompareResult {
  baseline_method: SellingMethod;
  methods: MethodResult[];
  difference_from_baseline: CompareDifference[];
  best_for_seller: SellingMethod;
}

/**
 * Compare several selling methods for the same sale. Baseline is eBay if present,
 * else the first requested method. Mirrors the MCP comparison shaping.
 */
export function compareSellingMethods(
  input: ComputeInput,
  methods: SellingMethod[] = DEFAULT_METHODS,
): CompareResult {
  const unique = [...new Set(methods)];
  const results = unique.map((m) => computeMethod(m, input));

  const baseline_method: SellingMethod = unique.includes("ebay") ? "ebay" : (unique[0] as SellingMethod);
  const baseline = results.find((r) => r.method === baseline_method)!;

  const difference_from_baseline: CompareDifference[] = results.map((r) => ({
    method: r.method,
    delta_vs_baseline: round2(r.estimated_payout - baseline.estimated_payout),
  }));

  const best = results.reduce((a, b) => (b.estimated_payout > a.estimated_payout ? b : a));

  return {
    baseline_method,
    methods: results,
    difference_from_baseline,
    best_for_seller: best.method,
  };
}

// ---------------------------------------------------------------------------
// Inverse: required sale price for a target net (Scout tool calculate_required_sale_price)
// ---------------------------------------------------------------------------

export interface RequiredSalePriceResult {
  method: SellingMethod;
  target_net: number;
  required_sale_price: number | null;
  achieved_net: number | null;
  iterations: number;
  converged: boolean;
}

/**
 * Solve for the per-item sale price needed to net `targetNet` on a method, given
 * fixed non-price inputs. Uses bisection over the monotonic payout(price)
 * relationship — no model arithmetic. Returns null if it cannot reach the target
 * within bounds. This is the deterministic backing for the
 * `calculate_required_sale_price` Scout tool.
 */
export function requiredSalePriceForNet(
  method: SellingMethod,
  targetNet: number,
  base: Omit<ComputeInput, "sale_price">,
  opts: { maxPrice?: number; tolerance?: number; maxIterations?: number } = {},
): RequiredSalePriceResult {
  const { maxPrice = 1_000_000, tolerance = 0.01, maxIterations = 60 } = opts;

  const netAt = (price: number): number => {
    const r = computeMethod(method, { ...base, sale_price: price });
    // Net = payout minus acquisition cost when supplied; else payout.
    return base.acquisition_cost !== undefined
      ? round2(r.estimated_payout - base.acquisition_cost)
      : r.estimated_payout;
  };

  if (targetNet <= 0) {
    return { method, target_net: targetNet, required_sale_price: 0, achieved_net: netAt(0), iterations: 0, converged: true };
  }
  if (netAt(maxPrice) < targetNet) {
    return { method, target_net: targetNet, required_sale_price: null, achieved_net: null, iterations: 0, converged: false };
  }

  let lo = 0;
  let hi = maxPrice;
  let iterations = 0;
  while (hi - lo > tolerance && iterations < maxIterations) {
    const mid = (lo + hi) / 2;
    if (netAt(mid) >= targetNet) hi = mid;
    else lo = mid;
    iterations += 1;
  }
  const price = round2(hi);
  return {
    method,
    target_net: targetNet,
    required_sale_price: price,
    achieved_net: netAt(price),
    iterations,
    converged: true,
  };
}
