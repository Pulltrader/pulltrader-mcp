// =============================================================================
// SELLER-ECONOMICS FEE ENGINE (canonical source: @pulltrader/scout-domain)
// =============================================================================
// The deterministic fee/payout math now lives in the shared `@pulltrader/scout-domain`
// package (the `FeeEngine`), parity-tested against both this worker's original
// engine and the Pulltrader backend payout calculator. This module is a thin
// re-export shim that preserves the worker's existing `../fees/calculator` import
// path. Do not fork the logic here — edit it in the shared package.
// =============================================================================

export {
  computeMethod,
  computeCompetitor,
  competitorCommissionPerItem,
  compareSellingMethods,
  requiredSalePriceForNet,
  getBinzPayout,
  marketplacePayout,
  externalPayout,
  storefrontPayout,
  platformFee,
  ebayFvfPerItem,
  round2,
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
} from "@pulltrader/scout-domain";
