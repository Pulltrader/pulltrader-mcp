// =============================================================================
// VERSIONED FEE SCHEDULES (canonical)
// =============================================================================
// This is the ONE place fee values are defined for the Scout domain. It is a
// faithful copy of the values previously duplicated across:
//   - cloudflare-workers/pulltrader-mcp/src/fees/schedule.ts
//   - pulltrader-marketing/lib/seo/fees/schedule.ts
//   - pulltrader-backend/utils/payoutCalculator.js (Pulltrader payout values)
//
// Goal of Stage 0: make THIS the single source so the MCP server, marketing
// calculators, and backend payout math can import it instead of maintaining
// four hand-synced copies. Pulltrader values are authoritative; eBay and
// competitor values are ESTIMATES of published competitor fees, labeled as such.
//
// When a fee changes: update here, bump `version` + dates, then have consumers
// re-import. Parity with the current MCP/backend behavior is locked by
// feeEngine.test.ts.
// =============================================================================

export type SellerPlan = "free" | "operations" | "business" | "managed";

/**
 * Seller level (1-5) is the source of truth for the marketplace payout rate.
 * It is set from plan AND revenue, so levels 2 and 4 are reachable on sales
 * volume alone and cannot be derived from a plan.
 */
export type SellerLevel = 1 | 2 | 3 | 4 | 5;

export type CompetitorMethod =
  | "tcgplayer"
  | "manapool"
  | "misprint"
  | "fanatics_collect"
  | "goldin";

/** A two-tier final value fee: rate_percent up to threshold (per item), then
 *  over_threshold_percent on the portion above. */
export interface EbayFvfTier {
  rate_percent: number;
  threshold: number;
  over_threshold_percent: number;
}

export interface EbayFeeSchedule {
  version: string;
  effective_date: string;
  review_by: string;
  source: string;
  source_url: string;
  currency: "USD";
  individual: EbayFvfTier;
  store: EbayFvfTier;
  per_order_fee_low: number;
  per_order_fee_high: number;
  per_order_fee_threshold: number;
  fee_base: "item_plus_shipping";
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
  platform_fee_percent: number;
  platform_fee_fixed: number;
  /** Payout rate by seller level — the authoritative table. */
  level_rates: Record<SellerLevel, number>;
  /** Rate a plan grants on its own; a seller's level may be higher. */
  seller_level_rates: Record<SellerPlan, number>;
  external_rate_percent: number;
  binz_fixed: Record<string, number>;
  estimated: false;
}

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
  commission_percent?: number;
  commission_tiers?: CompetitorCommissionTier[];
  commission_cap_per_item: number | null;
  commission_base: "item" | "item_plus_shipping";
  processing_percent: number;
  processing_fixed: number;
  processing_base: "none" | "item" | "item_plus_shipping";
  excluded: string[];
  conditional_notes: string[];
  category_note: string;
  estimated: true;
}

// -----------------------------------------------------------------------------
// Pulltrader — AUTHORITATIVE (mirrors the internal fee configuration @ 2026-06)
// -----------------------------------------------------------------------------
/**
 * Marketplace payout rate by seller level. Seller level is the source of
 * truth for the rate; it is set from plan AND revenue, so a level can be
 * reached that no plan grants on its own (level 2 and 4).
 */
export const SELLER_LEVEL_RATES: Record<SellerLevel, number> = {
  1: 91,
  2: 92,
  3: 93,
  4: 94,
  5: 95,
};

export const PULLTRADER_FEES: PulltraderFeeSchedule = {
  version: "2026-06-01",
  effective_date: "2026-06-01",
  review_by: "2026-12-01",
  source: "Pulltrader payout and platform-fee configuration",
  source_url: "https://pulltrader.app/sell",
  currency: "USD",
  platform_fee_percent: 3.25,
  platform_fee_fixed: 0.4,
  level_rates: SELLER_LEVEL_RATES,
  // Rate a plan grants on its own. A seller's actual rate comes from their
  // seller level: Operations starts at level 1 and earns higher levels through
  // revenue, so only Business/Managed lift this floor by subscribing.
  seller_level_rates: {
    free: SELLER_LEVEL_RATES[1],
    operations: SELLER_LEVEL_RATES[1],
    business: SELLER_LEVEL_RATES[5],
    managed: SELLER_LEVEL_RATES[5],
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
export const EBAY_FEES: EbayFeeSchedule = {
  version: "2026-06-27",
  effective_date: "2026-06-27",
  review_by: "2026-09-27",
  source: "eBay published selling fees, Trading Cards category",
  source_url: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees",
  currency: "USD",
  individual: { rate_percent: 13.25, threshold: 7500, over_threshold_percent: 2.35 },
  store: { rate_percent: 12.35, threshold: 2500, over_threshold_percent: 2.35 },
  per_order_fee_low: 0.3,
  per_order_fee_high: 0.4,
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

export const COMPETITOR_FEES: Record<CompetitorMethod, CompetitorFeeSchedule> = {
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
  manapool: {
    method: "manapool",
    label: "Sell on Mana Pool",
    where_it_sells: "Mana Pool",
    version: "2026-06-27",
    effective_date: "2026-06-27",
    review_by: "2026-09-27",
    source: "Mana Pool published marketplace & processing fees",
    source_url:
      "https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees",
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
  fanatics_collect: {
    method: "fanatics_collect",
    label: "Sell on Fanatics Collect (Buy Now)",
    where_it_sells: "Fanatics Collect",
    version: "2026-06-27",
    effective_date: "2026-06-27",
    review_by: "2026-09-27",
    source: "Fanatics Collect Buy Now marketplace seller fee announcement",
    source_url:
      "https://www.fanaticscollect.com/newsroom/introducing-simpler-fees-for-sellers-in-the-new-buy-now-marketplace",
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
      "Pulltrader can consign graded cards to Fanatics Collect auctions: seller keeps 100% of hammer; Pulltrader deducts $1/card at payout (waived for approved Dealer Network bulk). That path is outside this Buy Now fee model.",
    ],
    category_note: "Sports and collectibles, Buy Now fixed-price marketplace.",
    estimated: true,
  },
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

/** Map a Pulltrader seller plan to the legacy seller level (1-5). */
export const PLAN_TO_SELLER_LEVEL: Record<SellerPlan, number> = {
  free: 1,
  operations: 1,
  business: 5,
  managed: 5,
};
