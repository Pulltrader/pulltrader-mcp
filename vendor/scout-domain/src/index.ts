// @pulltrader/scout-domain — canonical Scout domain logic.
//
// Single source of truth for comparable-sales statistics, the seller-economics
// fee engine, and price-history aggregation, shared by the Pulltrader backend,
// the Scout MCP server, and the Scout Discord bot.

export { round2, toFiniteNumber } from "./money";

// Comparable-sales statistics
export {
  summarizeCompStats,
  removeOutliers,
  toCompSearchStats,
  toScoutV2Stats,
  type OutlierMethod,
  type CompStatsOptions,
  type CompStats,
  type Confidence,
  type CompSearchStatsShape,
  type ScoutV2StatsShape,
} from "./stats/compStats";

// Fee schedules
export {
  PULLTRADER_FEES,
  EBAY_FEES,
  COMPETITOR_FEES,
  PLAN_TO_SELLER_LEVEL,
  isScheduleStale,
  type SellerPlan,
  type SellerLevel,
  type CompetitorMethod,
  type EbayFeeSchedule,
  type PulltraderFeeSchedule,
  type CompetitorFeeSchedule,
} from "./fees/schedule";

// Fee engine
export {
  computeMethod,
  computeCompetitor,
  competitorCommissionPerItem,
  compareSellingMethods,
  requiredSalePriceForNet,
  getBinzPayout,
  marketplacePayout,
  resolveSellerRate,
  externalPayout,
  storefrontPayout,
  platformFee,
  ebayFvfPerItem,
  SUPPORTED_METHODS,
  DEFAULT_METHODS,
  COMPETITOR_METHODS,
  type SellingMethod,
  type FeeComponent,
  type MethodResult,
  type ComputeInput,
  type CompareDifference,
  type CompareResult,
  type RequiredSalePriceResult,
} from "./fees/feeEngine";

// Marketplace-channel pricing (per-marketplace pricing anchored to a master price)
export {
  channelNet,
  requiredListForNet,
  grossUpFromMaster,
  channelMinPrice,
  CHANNEL_DEFS,
  CHANNEL_ORDER,
  SELLER_LEVEL_RATES,
  FANATICS_LISTING_FEE_CENTS_DEFAULT,
  type PricingChannel,
  type PricingMode,
  type SellerPricingContext,
  type ChannelNetModel,
  type ChannelDef,
  type ChannelNetResult,
  type RequiredListResult,
  type GrossUpResult,
} from "./fees/channelPricing";

// Price history
export {
  buildPriceHistory,
  type HistoryInterval,
  type HistoryStatistic,
  type TrendDirection,
  type SaleRecordInput,
  type PriceHistoryOptions,
  type PriceHistoryPoint,
  type PriceHistoryTrend,
  type PriceHistoryResult,
} from "./priceHistory/priceHistoryService";
