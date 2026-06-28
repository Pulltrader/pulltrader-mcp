// =============================================================================
// VERSIONED FEE SCHEDULES
// =============================================================================
//
// This is the ONE place fee values are defined for the MCP server. Update this
// file (and bump `version` + dates) when a fee schedule changes, then ship a new
// release. The operational process is documented in docs/FEE_SCHEDULES.md.
//
// Pulltrader values mirror Pulltrader's authoritative internal fee configuration.
// Do NOT edit Pulltrader values here without updating that authoritative source
// first, so this server and the platform stay in agreement.
//
// eBay values are ESTIMATES of a competitor's published fees. They are labeled
// estimated everywhere and are intended to give sellers directional context, not
// a guaranteed payout. They exclude several conditional costs (see `excluded`).
// =============================================================================

/** A two-tier final value fee: `rate_percent` up to `threshold` (per item),
 *  then `over_threshold_percent` on the portion above. */
export interface EbayFvfTier {
  rate_percent: number;
  threshold: number;
  over_threshold_percent: number;
}

export interface EbayFeeSchedule {
  /** Bump on any value change. */
  version: string;
  /** When this schedule took effect (ISO date). */
  effective_date: string;
  /** Re-verify against the source on/before this date (ISO date). */
  review_by: string;
  source: string;
  source_url: string;
  currency: "USD";
  /** Final value fee for individuals (no Store subscription). */
  individual: EbayFvfTier;
  /** Final value fee for eBay Store subscribers. */
  store: EbayFvfTier;
  /** Per-order fee for orders at/below `per_order_fee_threshold`. */
  per_order_fee_low: number;
  /** Per-order fee for orders above `per_order_fee_threshold`. */
  per_order_fee_high: number;
  /** Order-total threshold (dollars) that selects the per-order fee. */
  per_order_fee_threshold: number;
  /** What the percentage fee is applied to. */
  fee_base: "item_plus_shipping";
  /** Costs intentionally NOT modeled — must be disclosed to the user. */
  excluded: string[];
  estimated: true;
}

export interface PulltraderFeeSchedule {
  version: string;
  effective_date: string;
  review_by: string;
  source: string;
  source_url: string;
  currency: "USD";
  /** Platform processing fee applied at checkout (item + shipping + tax). */
  platform_fee_percent: number;
  platform_fee_fixed: number;
  /** Seller plan -> marketplace payout % of item subtotal. */
  seller_level_rates: Record<SellerPlan, number>;
  /** Flat payout % for synced external (e.g. eBay) consignment sales. */
  external_rate_percent: number;
  /** Binz fixed payouts for specific low item prices (string price -> payout). */
  binz_fixed: Record<string, number>;
  estimated: false;
}

export type SellerPlan = "free" | "starter" | "pro" | "shop";

// -----------------------------------------------------------------------------
// Pulltrader — AUTHORITATIVE (mirrors the internal fee configuration @ 2026-06)
// -----------------------------------------------------------------------------
export const PULLTRADER_FEES: PulltraderFeeSchedule = {
  version: "2026-06-01",
  effective_date: "2026-06-01",
  review_by: "2026-12-01",
  source: "Pulltrader payout and platform-fee configuration",
  source_url: "https://pulltrader.app/sell",
  currency: "USD",
  platform_fee_percent: 3.25,
  platform_fee_fixed: 0.4,
  seller_level_rates: {
    free: 91, // seller level 1
    starter: 93, // seller level 3
    pro: 94, // seller level 4
    shop: 95, // seller level 5
  },
  external_rate_percent: 85,
  binz_fixed: {
    "0.05": 0.03,
    "0.1": 0.06,
    "0.25": 0.15,
    "0.5": 0.3,
    "1": 0.6,
    "3": 2.4,
    "5": 4.25,
    "10": 8.5,
  },
  estimated: false,
};

// -----------------------------------------------------------------------------
// eBay — ESTIMATED competitor schedule (directional only)
// -----------------------------------------------------------------------------
// Trading-card final value fees, applied to the total sale amount (item +
// shipping), calculated per item, with a two-tier structure and a Store-
// subscription option. The per-order fee depends on the order total.
export const EBAY_FEES: EbayFeeSchedule = {
  version: "2026-06-27",
  effective_date: "2026-06-27",
  review_by: "2026-09-27",
  source: "eBay published selling fees, Trading Cards category",
  source_url: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees",
  currency: "USD",
  individual: { rate_percent: 13.25, threshold: 7500, over_threshold_percent: 2.35 },
  store: { rate_percent: 12.35, threshold: 2500, over_threshold_percent: 2.35 },
  per_order_fee_low: 0.3, // orders <= $10.00
  per_order_fee_high: 0.4, // orders > $10.00
  per_order_fee_threshold: 10.0,
  fee_base: "item_plus_shipping",
  excluded: [
    "Promoted Listings ad fees",
    "International / cross-border transaction fees",
    "Below-standard seller performance surcharges",
    "Buyer-paid sales tax (handling varies by state)",
    "The seller's own shipping-label cost on self-fulfilled orders",
  ],
  estimated: true,
};

/** A schedule is stale once the current date is past its review_by date. */
export function isScheduleStale(reviewByIso: string, now: Date = new Date()): boolean {
  const reviewBy = new Date(`${reviewByIso}T23:59:59Z`).getTime();
  if (Number.isNaN(reviewBy)) return true;
  return now.getTime() > reviewBy;
}

// =============================================================================
// COMPETITOR MARKETPLACES — ESTIMATED (fixed-price / Buy Now seller fees only)
// =============================================================================
//
// These model what a seller KEEPS on a fixed-price ("Buy Now" / marketplace)
// sale on each platform. They are ESTIMATES of competitors' published seller
// fees, labeled estimated everywhere and intended for directional context.
//
// Auction formats (e.g. Goldin Elite/Weekly, Fanatics auctions) use hammer
// price + buyer's premium + negotiated consignment and are NOT modeled here —
// only the fixed-price seller fee is. Each schedule documents its source, a
// representative rate, the costs it excludes, and conditional cases.
// =============================================================================

export type CompetitorMethod =
  | "tcgplayer"
  | "manapool"
  | "misprint"
  | "fanatics_collect"
  | "goldin";

/** A commission tier: `rate_percent` applies when the per-item price is at or
 *  below `up_to` (use `null` for the final, open-ended tier). */
export interface CompetitorCommissionTier {
  up_to: number | null;
  rate_percent: number;
}

export interface CompetitorFeeSchedule {
  method: CompetitorMethod;
  label: string;
  where_it_sells: string;
  version: string;
  effective_date: string;
  review_by: string;
  source: string;
  source_url: string;
  currency: "USD";
  /** Flat seller commission %. Set this OR `commission_tiers`, not both. */
  commission_percent?: number;
  /** Tiered seller commission by per-item price (e.g. Goldin). */
  commission_tiers?: CompetitorCommissionTier[];
  /** Per-item commission cap in dollars (e.g. TCGplayer $75). */
  commission_cap_per_item: number | null;
  /** What the commission % is applied to. */
  commission_base: "item" | "item_plus_shipping";
  /** Payment processing fee. Use base "none" when the platform does not break
   *  out a separate processing fee (the commission is all-in). */
  processing_percent: number;
  processing_fixed: number;
  processing_base: "none" | "item" | "item_plus_shipping";
  /** Costs intentionally NOT modeled — disclosed to the user. */
  excluded: string[];
  /** Conditional / non-default cases the user should know about. */
  conditional_notes: string[];
  /** Which cards the platform is for (relevance note). */
  category_note: string;
  estimated: true;
}

export const COMPETITOR_FEES: Record<CompetitorMethod, CompetitorFeeSchedule> = {
  // TCGplayer — Marketplace Seller (Level 1-4) representative rate.
  tcgplayer: {
    method: "tcgplayer",
    label: "Sell on TCGplayer",
    where_it_sells: "TCGplayer",
    version: "2026-06-27",
    effective_date: "2026-06-27",
    review_by: "2026-09-27",
    source: "TCGplayer published commissions & fees (Marketplace Seller, Level 1-4)",
    source_url: "https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees",
    currency: "USD",
    commission_percent: 10.75,
    commission_cap_per_item: 75,
    commission_base: "item",
    processing_percent: 2.5,
    processing_fixed: 0.3,
    processing_base: "item_plus_shipping",
    excluded: [
      "Buyer-paid sales tax (included in TCGplayer's processing base, excluded here)",
      "TCGplayer Direct fulfillment per-item fees",
      "Third-party sync / BinderPOS fees",
      "The seller's own shipping-label cost",
    ],
    conditional_notes: [
      "Pro / Sync sellers pay a lower 9.25% commission plus a 2.5% Pro fee.",
      "The marketplace commission is capped at $75 per item.",
      "Cards under $2.49 use a special 50%-of-value fee not modeled here.",
    ],
    category_note: "TCG singles and sealed (Magic, Pokémon, Yu-Gi-Oh, and more).",
    estimated: true,
  },
  // Mana Pool — flat 5% + 2.9% + $0.30 processing.
  manapool: {
    method: "manapool",
    label: "Sell on Mana Pool",
    where_it_sells: "Mana Pool",
    version: "2026-06-27",
    effective_date: "2026-06-27",
    review_by: "2026-09-27",
    source: "Mana Pool published marketplace & processing fees",
    source_url: "https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees",
    currency: "USD",
    commission_percent: 5,
    commission_cap_per_item: null,
    commission_base: "item",
    processing_percent: 2.9,
    processing_fixed: 0.3,
    processing_base: "item_plus_shipping",
    excluded: ["The seller's own shipping-label cost"],
    conditional_notes: [
      "The 5% marketplace fee applies to the item price only, not shipping.",
      "Credit-card processing (2.9% + $0.30) applies to the whole order, including shipping.",
    ],
    category_note: "Magic: The Gathering singles and sealed only.",
    estimated: true,
  },
  // Misprint — flat 7% + 3% + $0.30 processing, both on item + shipping.
  misprint: {
    method: "misprint",
    label: "Sell on Misprint",
    where_it_sells: "Misprint",
    version: "2026-06-27",
    effective_date: "2026-06-27",
    review_by: "2026-09-27",
    source: "Misprint published seller fees (base tier)",
    source_url: "https://www.misprint.com/help/seller-levels",
    currency: "USD",
    commission_percent: 7,
    commission_cap_per_item: null,
    commission_base: "item_plus_shipping",
    processing_percent: 3,
    processing_fixed: 0.3,
    processing_base: "item_plus_shipping",
    excluded: ["The seller's own shipping-label cost"],
    conditional_notes: [
      "The 7% base commission drops at higher seller levels.",
      "Both the platform fee and processing apply to the total, including shipping.",
    ],
    category_note: "Graded cards and Pokémon focus (PSA, BGS, CGC, TAG), singles and sealed.",
    estimated: true,
  },
  // Fanatics Collect — Buy Now marketplace, standard 6% seller fee.
  fanatics_collect: {
    method: "fanatics_collect",
    label: "Sell on Fanatics Collect (Buy Now)",
    where_it_sells: "Fanatics Collect",
    version: "2026-06-27",
    effective_date: "2026-06-27",
    review_by: "2026-09-27",
    source: "Fanatics Collect Buy Now marketplace seller fee announcement",
    source_url: "https://www.fanaticscollect.com/newsroom/introducing-simpler-fees-for-sellers-in-the-new-buy-now-marketplace",
    currency: "USD",
    commission_percent: 6,
    commission_cap_per_item: null,
    commission_base: "item",
    processing_percent: 0,
    processing_fixed: 0,
    processing_base: "none",
    excluded: ["The seller's own shipping-label cost", "Vault storage and withdrawal fees"],
    conditional_notes: [
      "The 6% rate is for Buy Now listings priced at or near market value; listings well above market value can incur a 15% fee.",
      "Auction sales use a different model (seller gets 100% of the hammer plus bonus; the buyer pays a 22% premium) and are not modeled here.",
    ],
    category_note: "Sports and collectibles, Buy Now fixed-price marketplace.",
    estimated: true,
  },
  // Goldin — fixed-price Marketplace, tiered seller commission by price.
  goldin: {
    method: "goldin",
    label: "Sell on Goldin (Marketplace)",
    where_it_sells: "Goldin",
    version: "2026-06-27",
    effective_date: "2026-06-27",
    review_by: "2026-09-27",
    source: "Goldin published Marketplace seller commission tiers",
    source_url: "https://goldin.co/about.html",
    currency: "USD",
    commission_tiers: [
      { up_to: 2499.99, rate_percent: 16.7 },
      { up_to: 4999.99, rate_percent: 12.5 },
      { up_to: 9999.99, rate_percent: 10 },
      { up_to: 249999.99, rate_percent: 8.3 },
      { up_to: null, rate_percent: 8.3 },
    ],
    commission_cap_per_item: null,
    commission_base: "item",
    processing_percent: 0,
    processing_fixed: 0,
    processing_base: "none",
    excluded: ["The seller's own shipping-label cost"],
    conditional_notes: [
      "This is Goldin's fixed-price Marketplace, which requires graded items held in the Goldin/Collectors Vault (valued $100+). Auctions are a separate format.",
      "A 22% buyer's premium ($19 minimum) applies to Marketplace purchases as well as auctions. The buyer pays it, so it does not reduce your payout, but the buyer pays more than the listed price.",
      "Commission above $250,000 is negotiated individually; the estimate uses the $10k-$250k rate.",
      "Goldin periodically runs promotional rates (e.g. 8.3% across all tiers).",
      "In auctions (Weekly/Elite) the seller keeps roughly 100% of the hammer with negotiated consignment; that format is not modeled here.",
    ],
    category_note: "Sports and collectibles, fixed-price Marketplace (auction house).",
    estimated: true,
  },
};
