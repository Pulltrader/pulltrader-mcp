// =============================================================================
// FEE SCHEDULES (canonical source: @pulltrader/scout-domain)
// =============================================================================
// The versioned, dated fee schedules now live in the shared `@pulltrader/scout-domain`
// package so the MCP server, the Pulltrader backend, and the Scout Discord bot all
// read the SAME fee data and return identical numbers. This module is a thin
// re-export shim that preserves the worker's existing `../fees/schedule` import
// path. Do not fork these values here — edit them in the shared package.
// =============================================================================

export {
  PULLTRADER_FEES,
  EBAY_FEES,
  COMPETITOR_FEES,
  PLAN_TO_SELLER_LEVEL,
  SELLER_LEVEL_RATES,
  isScheduleStale,
  type SellerPlan,
  type SellerLevel,
  type CompetitorMethod,
  type EbayFeeSchedule,
  type PulltraderFeeSchedule,
  type CompetitorFeeSchedule,
} from "@pulltrader/scout-domain";
