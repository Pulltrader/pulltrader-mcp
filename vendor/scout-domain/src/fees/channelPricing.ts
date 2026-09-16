// =============================================================================
// CANONICAL MARKETPLACE-CHANNEL PRICING
// =============================================================================
// Per-marketplace pricing anchored to a single anchor (Pulltrader) price.
//
// Every item has ONE anchor price = its Pulltrader list price. For each channel
// the item is listed to we can either:
//   - auto: gross the channel's list price up/down so the seller nets what they
//     would net on Pulltrader at the anchor price, or
//   - manual: set the channel's list price directly.
//
// Net is CHANNEL-SPECIFIC and must be shown to the seller with the reason why:
//   - pulltrader : seller-level tier % (levels 1-5 -> 91-95%), less the platform
//                  fee when the seller covers fees. (e.g. L5 nets $95 on $100)
//   - ebay_fbp   : flat FBP fee -> 85%. (e.g. nets $85 on $100)
//   - ebay_self  : Pulltrader takes no cut; the seller keeps up to 100% and only
//                  loses the platform fee when they choose to cover it. eBay's own
//                  FVF is paid by the seller directly to eBay and is reference-only.
//   - fanatics_collect : 100% of hammer minus $1/card listing fee at payout
//                  (waived for Dealer Network bulk).
//
// This module is the single source of truth for the shape of channel pricing.
// It is intentionally pure and mirrors pulltrader-backend/utils/payoutCalculator.js
// (whose parity with this package is locked by feeEngine.test.ts). The backend
// computes the same numbers via payoutCalculator; the frontend mirrors these
// models in sellerEconomics.js for live readouts.
// =============================================================================

import { round2 } from "../money";
import { getBinzPayout, platformFee } from "./feeEngine";
import { PULLTRADER_FEES, type PulltraderFeeSchedule } from "./schedule";

/**
 * Channels an item can be priced for. `pulltrader` is always the anchor: the
 * seller's Pulltrader price, which is what their Storefront charges. CollectIQ
 * (the Pulltrader-hosted marketplace) is a channel of its own because it pays
 * out on the seller-level tier rather than the Storefront model.
 */
export type PricingChannel =
  | "pulltrader"
  | "collectiq"
  | "ebay_fbp"
  | "ebay_self"
  | "shopify"
  | "manapool"
  | "fanatics_collect";

/** How a channel's price is decided. */
export type PricingMode = "auto" | "manual";

/** Seller context that drives the net calculation. */
export interface SellerPricingContext {
  /** Seller level 1-5 (Free..Shop). Drives the Pulltrader marketplace tier %. */
  sellerLevel: number;
  /** Whether the seller covers the platform fee instead of the buyer. */
  coversFees?: boolean;
  /** Fanatics Collect listing fee in cents (default 100 = $1). */
  listingFeeCents?: number;
  /** When true, Fanatics $1/card fee is waived (e.g. Dealer Network bulk). */
  listingFeeWaived?: boolean;
}

/** Net model each channel uses (for labeling / UI grouping). */
export type ChannelNetModel =
  | "seller_tier"
  | "fbp_flat"
  | "storefront"
  | "manapool_flat"
  | "hammer_minus_listing_fee"
  | "unsupported";

/** Mana Pool (vault FBP) payout: flat 95% less a $0.30 per-sale fee. */
export const MANAPOOL_RATE_PERCENT = 95;
export const MANAPOOL_FEE_FIXED = 0.30;

/** Default Fanatics Collect Pulltrader listing fee ($1/card). */
export const FANATICS_LISTING_FEE_CENTS_DEFAULT = 100;

export interface ChannelDef {
  channel: PricingChannel;
  label: string;
  netModel: ChannelNetModel;
  /** True once outbound pricing/sync is actually implemented for the channel. */
  supported: boolean;
  /** Lowest list price the channel accepts. Auto floors here; Manual below it is rejected. */
  minPrice: number;
  /** Why the minimum exists, for the pricing UI. */
  minPriceReason?: string;
  /** What we tell sellers about pricing on this channel. */
  guidance?: string;
  /** Channel where we recommend listing at market rather than net parity. */
  suggestMarket?: boolean;
}

/** Canonical channel order for pricing UIs and read responses. */
export const CHANNEL_ORDER: PricingChannel[] = [
  "pulltrader",
  "collectiq",
  "ebay_fbp",
  "ebay_self",
  "manapool",
  "shopify",
  "fanatics_collect",
];

/** Seller-level payout rates (1-5). Mirrors payoutCalculator.SELLER_LEVEL_RATES. */
export const SELLER_LEVEL_RATES: Record<number, number> = {
  1: 91,
  2: 92,
  3: 93,
  4: 94,
  5: 95,
};

export const CHANNEL_DEFS: Record<PricingChannel, ChannelDef> = {
  pulltrader: {
    channel: "pulltrader",
    label: "Pulltrader price",
    netModel: "storefront",
    supported: true,
    minPrice: 0,
  },
  collectiq: {
    channel: "collectiq",
    label: "CollectIQ",
    netModel: "seller_tier",
    supported: true,
    minPrice: 1,
    minPriceReason: "CollectIQ checkout minimum is $1.00.",
    guidance: "Auto keeps your take-home equal to a Storefront sale.",
  },
  ebay_fbp: {
    channel: "ebay_fbp",
    label: "eBay (Fulfilled by Pulltrader)",
    netModel: "fbp_flat",
    supported: true,
    minPrice: 0.99,
    minPriceReason: "eBay fixed-price listings start at $0.99.",
    guidance: "Auto covers the FBP fee so you net the same as a Storefront sale.",
  },
  ebay_self: {
    channel: "ebay_self",
    label: "eBay (Self-Listing)",
    netModel: "storefront",
    supported: true,
    minPrice: 0.99,
    minPriceReason: "eBay fixed-price listings start at $0.99.",
    guidance: "Listed on your own eBay account; eBay fees are yours to review.",
  },
  shopify: { channel: "shopify", label: "Shopify", netModel: "unsupported", supported: false, minPrice: 0 },
  manapool: {
    channel: "manapool",
    label: "Mana Pool",
    netModel: "manapool_flat",
    supported: true,
    minPrice: 0.05,
    minPriceReason: "Mana Pool listings start at $0.05.",
    guidance: "We suggest listing TCG singles at market on Mana Pool. Auto is net parity; use Market to price at the going rate.",
    suggestMarket: true,
  },
  fanatics_collect: {
    channel: "fanatics_collect",
    label: "Fanatics Collect (Auction)",
    netModel: "hammer_minus_listing_fee",
    supported: true,
    minPrice: 0,
  },
};

/** Lowest list price a channel accepts (0 when unconstrained). */
export function channelMinPrice(channel: PricingChannel): number {
  return CHANNEL_DEFS[channel]?.minPrice ?? 0;
}

export interface ChannelNetResult {
  channel: PricingChannel;
  listPrice: number;
  /** Seller take-home at this list price on this channel. */
  net: number;
  /** Human-readable explanation of the net, for the pricing UI. */
  reason: string;
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  const n = Math.round(level);
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

/**
 * Net (seller take-home) for a given list price on a channel, with the reason.
 * Pure and monotonic non-decreasing in listPrice, so the inverse can bisect.
 */
export function channelNet(
  channel: PricingChannel,
  listPrice: number,
  ctx: SellerPricingContext,
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): ChannelNetResult {
  const price = Number.isFinite(listPrice) && listPrice > 0 ? round2(listPrice) : 0;
  const level = clampLevel(ctx.sellerLevel);
  const coversFees = !!ctx.coversFees;

  switch (channel) {
    case "pulltrader": {
      // The Pulltrader price is what the seller's Storefront charges. Storefront
      // sales are self-fulfilled: 100%, less the platform fee when the seller
      // covers it. Binz does not apply to Storefront sales.
      if (!coversFees) {
        return { channel, listPrice: price, net: round2(price), reason: "Storefront sale: you keep 100%" };
      }
      const fee = platformFee(price, schedule);
      return {
        channel,
        listPrice: price,
        net: Math.max(0, round2(price - fee)),
        reason: `Storefront sale, less platform fee (${schedule.platform_fee_percent}% + $${schedule.platform_fee_fixed.toFixed(2)})`,
      };
    }

    case "collectiq": {
      const binz = getBinzPayout(price, schedule);
      if (binz !== null) {
        return { channel, listPrice: price, net: round2(binz), reason: "Binz fixed pricing" };
      }
      const rate = SELLER_LEVEL_RATES[level] ?? SELLER_LEVEL_RATES[1]!;
      let net = price * (rate / 100);
      let reason = `Level ${level} (${rate}%)`;
      if (coversFees) {
        const fee = platformFee(price, schedule);
        net = Math.max(0, net - fee);
        reason = `Level ${level} (${rate}%), less platform fee (${schedule.platform_fee_percent}% + $${schedule.platform_fee_fixed.toFixed(2)})`;
      }
      return { channel, listPrice: price, net: round2(net), reason };
    }

    case "ebay_fbp": {
      const binz = getBinzPayout(price, schedule);
      if (binz !== null) {
        return { channel, listPrice: price, net: round2(binz), reason: "Binz fixed pricing" };
      }
      const rate = schedule.external_rate_percent; // flat 85%
      return {
        channel,
        listPrice: price,
        net: round2(price * (rate / 100)),
        reason: `FBP fee (${rate}%)`,
      };
    }

    case "ebay_self": {
      // Self-listing on the seller's own eBay account: Pulltrader takes no cut and
      // makes no payout. The net shown here is reference-only — the seller keeps the
      // full list price (less the platform fee if they cover it). Binz does not apply
      // because Pulltrader is not involved in the transaction.
      if (!coversFees) {
        return { channel, listPrice: price, net: round2(price), reason: "You keep 100% (fees not covered)" };
      }
      const fee = platformFee(price, schedule);
      return {
        channel,
        listPrice: price,
        net: Math.max(0, round2(price - fee)),
        reason: `Less platform fee (${schedule.platform_fee_percent}% + $${schedule.platform_fee_fixed.toFixed(2)}) — fees covered`,
      };
    }

    case "manapool": {
      // Vault FBP on Pulltrader's Mana Pool seller account: flat 95% less a
      // $0.30 per-sale fee. Binz does not apply.
      const net = Math.max(0, price * (MANAPOOL_RATE_PERCENT / 100) - MANAPOOL_FEE_FIXED);
      return {
        channel,
        listPrice: price,
        net: round2(net),
        reason: `Mana Pool fee (${MANAPOOL_RATE_PERCENT}% - $${MANAPOOL_FEE_FIXED.toFixed(2)})`,
      };
    }

    case "fanatics_collect": {
      const waived = !!ctx.listingFeeWaived;
      const feeCents = waived
        ? 0
        : ctx.listingFeeCents != null
          ? Number(ctx.listingFeeCents)
          : FANATICS_LISTING_FEE_CENTS_DEFAULT;
      const feeDollars = Math.max(0, feeCents / 100);
      const net = Math.max(0, price - feeDollars);
      const reason = waived
        ? "100% of hammer (Dealer Network listing fee waived)"
        : `100% of hammer less $${feeDollars.toFixed(2)} Pulltrader listing fee`;
      return { channel, listPrice: price, net: round2(net), reason };
    }

    default:
      throw new Error(`channelNet: unsupported channel "${channel}"`);
  }
}

export interface RequiredListResult {
  channel: PricingChannel;
  targetNet: number;
  listPrice: number | null;
  achievedNet: number | null;
  converged: boolean;
}

/**
 * Solve for the list price on a channel that nets `targetNet`. Bisection over the
 * monotonic channelNet(price) relationship — no per-channel algebra to keep wrong.
 */
export function requiredListForNet(
  channel: PricingChannel,
  targetNet: number,
  ctx: SellerPricingContext,
  opts: { maxPrice?: number; tolerance?: number; maxIterations?: number } = {},
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): RequiredListResult {
  const { maxPrice = 1_000_000, tolerance = 0.005, maxIterations = 64 } = opts;
  const netAt = (p: number) => channelNet(channel, p, ctx, schedule).net;

  if (targetNet <= 0) {
    return { channel, targetNet, listPrice: 0, achievedNet: netAt(0), converged: true };
  }
  if (netAt(maxPrice) < targetNet) {
    return { channel, targetNet, listPrice: null, achievedNet: null, converged: false };
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
  const listPrice = round2(hi);
  return { channel, targetNet, listPrice, achievedNet: netAt(listPrice), converged: true };
}

export interface GrossUpResult {
  channel: PricingChannel;
  masterPrice: number;
  /** Net the seller would take home on a Storefront sale at the anchor price. */
  targetNet: number;
  /** Auto list price for the channel (equals masterPrice for pulltrader). */
  listPrice: number | null;
  reason: string;
  converged: boolean;
  /** True when the solved price was raised to the channel minimum. */
  floored?: boolean;
}

/**
 * Auto price for a channel, anchored to the anchor (Pulltrader) price: gross the
 * channel's list price up/down so the seller nets what they net on Pulltrader at
 * `masterPrice`. Pulltrader itself always returns the anchor price unchanged.
 */
export function grossUpFromMaster(
  channel: PricingChannel,
  masterPrice: number,
  ctx: SellerPricingContext,
  schedule: PulltraderFeeSchedule = PULLTRADER_FEES,
): GrossUpResult {
  const master = Number.isFinite(masterPrice) && masterPrice > 0 ? round2(masterPrice) : 0;
  const target = channelNet("pulltrader", master, ctx, schedule).net;

  if (channel === "pulltrader") {
    return {
      channel,
      masterPrice: master,
      targetNet: target,
      listPrice: master,
      reason: "Your Pulltrader price (Storefront)",
      converged: true,
    };
  }

  // If the channel already nets the target at the anchor price (e.g. both
  // channels share a Binz fixed payout), use the anchor price directly rather
  // than letting the bisection find a cheaper non-Binz equivalent.
  const netAtMaster = channelNet(channel, master, ctx, schedule);
  if (netAtMaster.net === target) {
    return {
      channel,
      masterPrice: master,
      targetNet: target,
      listPrice: master,
      reason: `Priced to net $${target.toFixed(2)} — ${netAtMaster.reason}`,
      converged: true,
    };
  }

  const solved = requiredListForNet(channel, target, ctx, {}, schedule);
  let listPrice = solved.listPrice;
  let floored = false;
  const min = channelMinPrice(channel);
  if (listPrice !== null && listPrice < min) {
    listPrice = round2(min);
    floored = true;
  }
  const net = listPrice !== null ? channelNet(channel, listPrice, ctx, schedule) : null;
  let reason = "Could not reach target net";
  if (net) {
    reason = floored
      ? `Raised to the $${min.toFixed(2)} channel minimum — ${net.reason}`
      : `Priced to net $${target.toFixed(2)} — ${net.reason}`;
  }
  return {
    channel,
    masterPrice: master,
    targetNet: target,
    listPrice,
    reason,
    converged: listPrice !== null,
    floored,
  };
}
