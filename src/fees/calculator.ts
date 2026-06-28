// =============================================================================
// DETERMINISTIC SELLER ECONOMICS ENGINE
// =============================================================================
// Pure functions. No I/O, no clock, no randomness -> identical inputs always
// produce identical outputs. Mirrors Pulltrader's authoritative payout logic.
// =============================================================================

import {
  COMPETITOR_FEES,
  EBAY_FEES,
  PULLTRADER_FEES,
  type CompetitorFeeSchedule,
  type CompetitorMethod,
  type EbayFeeSchedule,
  type PulltraderFeeSchedule,
  type SellerPlan,
} from "./schedule";

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

/** Competitor marketplaces are estimated, fixed-price seller-fee models. */
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
  /** Who bears this fee. Only seller-borne fees reduce estimated_payout. */
  paid_by: "seller" | "buyer";
}

export interface MethodResult {
  method: SellingMethod;
  label: string;
  /** Value of the goods sold (unit price * quantity), excluding shipping. */
  gross_amount: number;
  estimated_total_fees: number;
  fee_breakdown: FeeComponent[];
  /** Estimated seller proceeds on the item (see assumptions for shipping handling). */
  estimated_payout: number;
  /** estimated_total_fees / gross_amount, as a percentage rounded to 2 dp. */
  effective_fee_rate: number;
  /** Optional: estimated_payout - acquisition_cost, when acquisition_cost given. */
  estimated_net_profit?: number;
  owns_listing: "seller" | "pulltrader";
  fulfilled_by: "seller" | "pulltrader";
  where_it_sells: string;
  /** True for the eBay estimate (so callers can label it). */
  estimated: boolean;
  notes: string[];
}

export interface ComputeInput {
  sale_price: number;
  quantity: number;
  shipping_amount: number;
  seller_plan: SellerPlan;
  seller_covers_fees: boolean;
  ebay_store_subscription: boolean;
  acquisition_cost?: number;
  ebay_fee_percent_override?: number;
  ebaySchedule?: EbayFeeSchedule;
  pulltraderSchedule?: PulltraderFeeSchedule;
}

/** Round to cents to match Pulltrader's payout rounding. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Binz fixed payout for a single item price. Returns null when Binz does not
 * apply. Mirrors Pulltrader's Binz payout logic.
 */
export function getBinzPayout(price: number, schedule: PulltraderFeeSchedule): number | null {
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

/** Platform fee: 3.25% + $0.40 (fixed applied once per order). */
export function platformFee(
  baseDollars: number,
  schedule: PulltraderFeeSchedule,
  includeFixed = true,
): number {
  if (baseDollars <= 0) return 0;
  const variable = round2(baseDollars * (schedule.platform_fee_percent / 100));
  return round2(variable + (includeFixed ? schedule.platform_fee_fixed : 0));
}

/**
 * eBay final value fee for a single item's sale amount (item + allocated
 * shipping), applying the two-tier structure. When `overridePercent` is given,
 * a flat rate is used and the tier is ignored.
 */
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

/** Per-unit marketplace payout: Binz if applicable, else seller-level %. */
function marketplaceUnitPayout(unitPrice: number, plan: SellerPlan, schedule: PulltraderFeeSchedule): number {
  const binz = getBinzPayout(unitPrice, schedule);
  if (binz !== null) return binz;
  const rate = schedule.seller_level_rates[plan];
  return round2(unitPrice * (rate / 100));
}

function ratePct(fees: number, gross: number): number {
  if (gross <= 0) return 0;
  return round2((fees / gross) * 100);
}

/** Seller commission on a single item's commission base (which the caller has
 *  already adjusted for `commission_base`), honoring flat-vs-tiered rates and
 *  any per-item cap. Tier selection uses the commission base amount. */
export function competitorCommissionPerItem(commissionBaseAmount: number, schedule: CompetitorFeeSchedule): number {
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

/** Estimated seller proceeds on a fixed-price sale at a competitor marketplace. */
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

  // Commission per item (optionally including its share of shipping).
  const commissionItemBase = schedule.commission_base === "item_plus_shipping" ? round2(unit + perUnitShipping) : unit;
  const commissionTotal = round2(competitorCommissionPerItem(commissionItemBase, schedule) * qty);

  // Payment processing (once per order) on the configured base.
  let processing = 0;
  if (schedule.processing_base !== "none") {
    const pbase = schedule.processing_base === "item_plus_shipping" ? orderTotal : gross;
    processing = round2(pbase * (schedule.processing_percent / 100) + schedule.processing_fixed);
  }

  const fees = round2(commissionTotal + processing);
  // Buyer pays item + shipping; seller receives it minus fees and pays their
  // own label out of the shipping collected (disclosed in notes/excluded).
  const payout = round2(gross + shipping - fees);

  const breakdown: FeeComponent[] = [
    {
      label: schedule.commission_tiers
        ? `${schedule.where_it_sells} seller commission (tiered by price)`
        : `${schedule.where_it_sells} seller fee (${schedule.commission_percent}%${schedule.commission_cap_per_item !== null ? `, capped $${schedule.commission_cap_per_item}/item` : ""})`,
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

  // Competitor marketplaces (estimated, fixed-price seller fees).
  const competitorSchedule = (COMPETITOR_FEES as Record<string, CompetitorFeeSchedule | undefined>)[method];
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
      // FVF is calculated per item on (item + its share of shipping).
      const perUnitShipping = qty > 0 ? shipping / qty : 0;
      const perUnitSale = round2(unit + perUnitShipping);
      const fvf = round2(ebayFvfPerItem(perUnitSale, tier, override) * qty);
      const orderTotal = round2(gross + shipping);
      const perOrderFee =
        orderTotal <= ebay.per_order_fee_threshold ? ebay.per_order_fee_low : ebay.per_order_fee_high;
      const fees = round2(fvf + perOrderFee);
      // eBay pays out (item + shipping) minus fees; the seller pays their own
      // label out of the shipping they collected (disclosed in notes/assumptions).
      const payout = round2(gross + shipping - fees);

      const fvfLabel = override !== undefined
        ? `eBay final value fee (${override}% of item + shipping, user-supplied)`
        : `eBay final value fee (${tier.rate_percent}% of item + shipping${input.ebay_store_subscription ? ", Store subscriber" : ""})`;
      const notes: string[] = [];
      if (override !== undefined) notes.push("eBay fee percentage was supplied by the user (flat rate, tiers ignored).");
      else if (input.ebay_store_subscription) notes.push(`Estimated using the eBay Store subscriber rate (${tier.rate_percent}% up to $${tier.threshold} per item, ${tier.over_threshold_percent}% above).`);
      else notes.push(`Estimated using the individual (no Store subscription) rate (${tier.rate_percent}% up to $${tier.threshold} per item, ${tier.over_threshold_percent}% above).`);
      notes.push(`Per-order fee is $${ebay.per_order_fee_low.toFixed(2)} for orders \u2264 $${ebay.per_order_fee_threshold.toFixed(2)}, otherwise $${ebay.per_order_fee_high.toFixed(2)}.`);
      notes.push("Excludes promoted listings, international fees, sales tax, and your own shipping-label cost.");

      result = {
        method,
        label: "Sell it yourself on eBay",
        gross_amount: gross,
        estimated_total_fees: fees,
        fee_breakdown: [
          { label: fvfLabel, amount: fvf, kind: "percentage", paid_by: "seller" },
          { label: `eBay per-order fee (order total $${orderTotal.toFixed(2)})`, amount: round2(perOrderFee), kind: "fixed", paid_by: "seller" },
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
      const sellerFeePayout = round2(marketplaceUnitPayout(unit, input.seller_plan, pt) * qty);
      let payout = sellerFeePayout;
      const breakdown: FeeComponent[] = [];
      // Seller fee (commission) — only on marketplace/FBP; always seller-borne.
      const sellerFee = round2(gross - sellerFeePayout);
      breakdown.push({
        label: `Pulltrader seller fee (${input.seller_plan} plan keeps ${pt.seller_level_rates[input.seller_plan]}% of the item)`,
        amount: sellerFee,
        kind: "percentage",
        paid_by: "seller",
      });
      // Platform fee — ALWAYS charged; buyer pays by default, seller can cover.
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
          `The platform fee is always charged; by default the buyer pays it at checkout, so it is not deducted from the seller.`,
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
        label: isFbp ? "Pulltrader marketplace (Fulfilled by Pulltrader)" : "Pulltrader marketplace (you ship)",
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
      // Platform fee — ALWAYS charged on card sales; buyer pays by default,
      // seller can cover. (Cash POS is fee-free; see notes.)
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
