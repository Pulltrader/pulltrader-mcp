// =============================================================================
// TOOL: calculate_required_sale_price
// =============================================================================
// Inverse of compare_selling_costs: given a target take-home amount, solve for
// the per-item sale price a seller must charge on ONE selling method, after fees.
// Deterministic (bisection over the canonical fee engine). No pricing/market data.
// =============================================================================

import { toolError, type ToolError } from "../errors";
import {
  COMPETITOR_FEES,
  EBAY_FEES,
  PULLTRADER_FEES,
  isScheduleStale,
  type CompetitorMethod,
  type SellerPlan,
  type SellerLevel,
} from "../fees/schedule";
import {
  computeMethod,
  requiredSalePriceForNet,
  round2,
  COMPETITOR_METHODS,
  SUPPORTED_METHODS,
  type ComputeInput,
  type MethodResult,
  type SellingMethod,
} from "../fees/calculator";

export const TOOL_NAME = "calculate_required_sale_price";

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: "Find the sale price needed to reach a target net payout",
  description:
    "Given a target take-home amount, compute the per-item sale price a trading-card seller must list at to net that amount on ONE selling method, after fees — eBay (estimated), a Pulltrader selling method (marketplace, Fulfilled by Pulltrader, branded storefront, in-person POS), or an estimated competitor marketplace (TCGplayer, Mana Pool, Misprint, Fanatics Collect, Goldin). " +
    "If acquisition_cost is supplied, the target is treated as net profit (payout minus what you paid); otherwise it is the take-home payout. " +
    "Use this when a seller asks 'what do I need to list this at to walk away with $X', 'to net/profit $X after fees', or 'to break even'. " +
    "Calculations are deterministic and use dated fee schedules. " +
    "Do NOT use this to look up a card's market value or recent sales (this tool does not price cards), and do NOT use it for non-trading-card categories. " +
    "Present eBay and competitor figures as estimates, never as guaranteed proceeds.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      target_net: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: 1_000_000,
        description:
          "The amount the seller wants to keep per item after fees. Net profit if acquisition_cost is supplied, otherwise take-home payout.",
      },
      method: {
        type: "string",
        enum: SUPPORTED_METHODS,
        default: "ebay",
        description:
          "The single selling method to solve for. One of: ebay, pulltrader_marketplace, pulltrader_fbp, pulltrader_storefront, pulltrader_pos, tcgplayer, manapool, misprint, fanatics_collect, goldin.",
      },
      currency: {
        type: "string",
        enum: ["USD"],
        default: "USD",
        description: "ISO currency code. Only USD is supported.",
      },
      quantity: {
        type: "integer",
        minimum: 1,
        maximum: 10_000,
        default: 1,
        description: "Number of identical items in one order. Per-order fixed fees are applied once.",
      },
      shipping_amount: {
        type: "number",
        minimum: 0,
        maximum: 100_000,
        default: 0,
        description: "Shipping amount charged to the buyer. Affects eBay's fee base.",
      },
      item_category: {
        type: "string",
        enum: ["trading_cards"],
        default: "trading_cards",
        description: "Item category. Only trading_cards is supported.",
      },
      seller_plan: {
        type: "string",
        enum: ["free", "operations", "business", "managed"],
        default: "free",
        description:
          "Pulltrader seller plan. Sets the payout floor (free/operations=91%, business/managed=95%); a seller level earned on revenue can be higher.",
      },
      seller_level: {
        type: "integer",
        enum: [1, 2, 3, 4, 5],
        description:
          "The seller's actual level (1-5), if known. Level is set from plan AND sales volume, so levels 2 and 4 exist only by earning them and cannot be inferred from a plan. Overrides the plan's rate: 1=91%, 2=92%, 3=93%, 4=94%, 5=95%.",
      },
      seller_covers_fees: {
        type: "boolean",
        default: false,
        description:
          "If true, the seller absorbs the Pulltrader platform fee (3.25% + $0.40). If false (default), the buyer pays it at checkout.",
      },
      ebay_store_subscription: {
        type: "boolean",
        default: false,
        description:
          "If true, estimate eBay fees using the eBay Store subscriber rate instead of the individual rate.",
      },
      acquisition_cost: {
        type: "number",
        minimum: 0,
        maximum: 1_000_000,
        description:
          "Optional. What the seller paid for the card. When supplied, target_net is interpreted as net profit (payout minus this cost).",
      },
      ebay_fee_percent_override: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Optional. Override the estimated eBay final value fee percentage.",
      },
    },
    required: ["target_net"],
  },
} as const;

export interface RequiredSuccess {
  ok: true;
  result: RequiredResult;
}
export interface RequiredFailure {
  ok: false;
  error: ToolError;
}
export type RequiredOutcome = RequiredSuccess | RequiredFailure;

export interface RequiredResult {
  currency: "USD";
  method: SellingMethod;
  target_net: number;
  net_basis: "net_profit_after_acquisition_cost" | "take_home_payout";
  quantity: number;
  shipping_amount: number;
  item_category: "trading_cards";
  seller_plan: SellerPlan;
  seller_level?: SellerLevel;
  required_sale_price: number | null;
  achieved_net: number | null;
  reachable: boolean;
  breakdown: MethodResult | null;
  assumptions: string[];
  inputs_used: Array<{ field: string; value: string | number | boolean; source: "provided" | "default" }>;
  fee_schedules: {
    ebay: { version: string; effective_date: string; source: string; source_url: string; estimated: true };
    pulltrader: { version: string; effective_date: string; source: string; source_url: string; estimated: false };
  };
  competitor_fee_schedule?: {
    method: CompetitorMethod;
    name: string;
    version: string;
    effective_date: string;
    source: string;
    source_url: string;
    estimated: true;
  };
  fee_schedule_version: string;
  warnings: string[];
  calculated_at: string;
  disclaimer: string;
  related_url: string;
}

type RawArgs = Record<string, unknown>;

function isPlainObject(v: unknown): v is RawArgs {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asFiniteNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

export interface ComputeOptions {
  now?: Date;
  relatedUrl?: string;
}

export function calculateRequiredSalePrice(args: unknown, options: ComputeOptions = {}): RequiredOutcome {
  const now = options.now ?? new Date();
  const relatedUrl = options.relatedUrl ?? "https://pulltrader.app/sell";

  if (!isPlainObject(args)) {
    return { ok: false, error: toolError("INVALID_INPUT", "Arguments must be an object.") };
  }

  const inputsUsed: RequiredResult["inputs_used"] = [];
  const track = (field: string, value: string | number | boolean, provided: boolean) =>
    inputsUsed.push({ field, value, source: provided ? "provided" : "default" });

  // --- target_net (required) ---
  const targetNet = asFiniteNumber(args.target_net);
  if (targetNet === null) {
    return { ok: false, error: toolError("INVALID_INPUT", "target_net is required and must be a finite number.", "target_net") };
  }
  if (targetNet <= 0) {
    return { ok: false, error: toolError("INVALID_INPUT", "target_net must be greater than 0.", "target_net") };
  }
  if (targetNet > 1_000_000) {
    return { ok: false, error: toolError("INVALID_INPUT", "target_net exceeds the supported maximum (1,000,000).", "target_net") };
  }
  track("target_net", targetNet, true);

  // --- method (single) ---
  let method: SellingMethod = "ebay";
  if (args.method !== undefined) {
    if (typeof args.method !== "string" || !SUPPORTED_METHODS.includes(args.method as SellingMethod)) {
      return { ok: false, error: toolError("UNSUPPORTED_SELLING_METHOD", `Unsupported selling method '${String(args.method)}'. Supported: ${SUPPORTED_METHODS.join(", ")}.`, "method") };
    }
    method = args.method as SellingMethod;
    track("method", method, true);
  } else {
    track("method", method, false);
  }

  // --- currency ---
  if (args.currency !== undefined) {
    if (typeof args.currency !== "string") {
      return { ok: false, error: toolError("INVALID_INPUT", "currency must be a string.", "currency") };
    }
    if (args.currency.toUpperCase() !== "USD") {
      return { ok: false, error: toolError("UNSUPPORTED_CURRENCY", `Currency '${args.currency}' is not supported. Only USD is available.`, "currency") };
    }
    track("currency", "USD", true);
  } else {
    track("currency", "USD", false);
  }

  // --- item_category ---
  if (args.item_category !== undefined) {
    if (typeof args.item_category !== "string") {
      return { ok: false, error: toolError("INVALID_INPUT", "item_category must be a string.", "item_category") };
    }
    if (args.item_category !== "trading_cards") {
      return { ok: false, error: toolError("UNSUPPORTED_CATEGORY", `Category '${args.item_category}' is not supported. Only trading_cards is available.`, "item_category") };
    }
    track("item_category", "trading_cards", true);
  } else {
    track("item_category", "trading_cards", false);
  }

  // --- quantity ---
  let quantity = 1;
  if (args.quantity !== undefined) {
    const q = asFiniteNumber(args.quantity);
    if (q === null || !Number.isInteger(q) || q < 1 || q > 10_000) {
      return { ok: false, error: toolError("INVALID_INPUT", "quantity must be an integer between 1 and 10,000.", "quantity") };
    }
    quantity = q;
    track("quantity", quantity, true);
  } else {
    track("quantity", quantity, false);
  }

  // --- shipping_amount ---
  let shipping = 0;
  if (args.shipping_amount !== undefined) {
    const s = asFiniteNumber(args.shipping_amount);
    if (s === null || s < 0 || s > 100_000) {
      return { ok: false, error: toolError("INVALID_INPUT", "shipping_amount must be a number between 0 and 100,000.", "shipping_amount") };
    }
    shipping = round2(s);
    track("shipping_amount", shipping, true);
  } else {
    track("shipping_amount", shipping, false);
  }

  // --- seller_plan ---
  const validPlans: SellerPlan[] = ["free", "operations", "business", "managed"];
  // Retired plan names still arrive from older MCP clients; map them onto the
  // current plan with the same payout level rather than rejecting the call.
  const legacyPlans: Record<string, SellerPlan> = {
    starter: "operations",
    pro: "business",
    shop: "business",
  };
  let sellerPlan: SellerPlan = "free";
  if (args.seller_plan !== undefined) {
    const raw = typeof args.seller_plan === "string" ? args.seller_plan : "";
    const mapped = (legacyPlans[raw] ?? raw) as SellerPlan;
    if (!validPlans.includes(mapped)) {
      return { ok: false, error: toolError("INVALID_INPUT", `seller_plan must be one of: ${validPlans.join(", ")}.`, "seller_plan") };
    }
    sellerPlan = mapped;
    track("seller_plan", sellerPlan, true);
  } else {
    track("seller_plan", sellerPlan, false);
  }

  // --- seller_level ---
  // A plan only sets the floor; a seller who earned level 2-4 on volume can
  // only be modelled by passing the level explicitly.
  let sellerLevel: SellerLevel | undefined;
  if (args.seller_level !== undefined && args.seller_level !== null) {
    const raw = args.seller_level;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return { ok: false, error: toolError("INVALID_INPUT", "seller_level must be an integer from 1 to 5.", "seller_level") };
    }
    sellerLevel = n as SellerLevel;
    track("seller_level", sellerLevel, true);
  }

  // --- seller_covers_fees ---
  let sellerCoversFees = false;
  if (args.seller_covers_fees !== undefined) {
    if (typeof args.seller_covers_fees !== "boolean") {
      return { ok: false, error: toolError("INVALID_INPUT", "seller_covers_fees must be a boolean.", "seller_covers_fees") };
    }
    sellerCoversFees = args.seller_covers_fees;
    track("seller_covers_fees", sellerCoversFees, true);
  } else {
    track("seller_covers_fees", sellerCoversFees, false);
  }

  // --- ebay_store_subscription ---
  let ebayStoreSubscription = false;
  if (args.ebay_store_subscription !== undefined) {
    if (typeof args.ebay_store_subscription !== "boolean") {
      return { ok: false, error: toolError("INVALID_INPUT", "ebay_store_subscription must be a boolean.", "ebay_store_subscription") };
    }
    ebayStoreSubscription = args.ebay_store_subscription;
    track("ebay_store_subscription", ebayStoreSubscription, true);
  } else {
    track("ebay_store_subscription", ebayStoreSubscription, false);
  }

  // --- acquisition_cost (optional) ---
  let acquisitionCost: number | undefined;
  if (args.acquisition_cost !== undefined) {
    const a = asFiniteNumber(args.acquisition_cost);
    if (a === null || a < 0 || a > 1_000_000) {
      return { ok: false, error: toolError("INVALID_INPUT", "acquisition_cost must be a number between 0 and 1,000,000.", "acquisition_cost") };
    }
    acquisitionCost = round2(a);
    track("acquisition_cost", acquisitionCost, true);
  }

  // --- ebay_fee_percent_override (optional) ---
  let ebayOverride: number | undefined;
  if (args.ebay_fee_percent_override !== undefined) {
    const e = asFiniteNumber(args.ebay_fee_percent_override);
    if (e === null || e < 0 || e > 100) {
      return { ok: false, error: toolError("INVALID_INPUT", "ebay_fee_percent_override must be a number between 0 and 100.", "ebay_fee_percent_override") };
    }
    ebayOverride = e;
    track("ebay_fee_percent_override", ebayOverride, true);
  }

  // --- freshness ---
  const warnings: string[] = [];
  if (method === "ebay" && isScheduleStale(EBAY_FEES.review_by, now)) {
    warnings.push(`The estimated eBay fee schedule (version ${EBAY_FEES.version}) is past its review date of ${EBAY_FEES.review_by} and may be out of date.`);
  }
  if (isScheduleStale(PULLTRADER_FEES.review_by, now)) {
    warnings.push(`The Pulltrader fee schedule (version ${PULLTRADER_FEES.version}) is past its review date of ${PULLTRADER_FEES.review_by} and may be out of date.`);
  }
  const isCompetitor = (COMPETITOR_METHODS as string[]).includes(method);
  if (isCompetitor) {
    const sched = COMPETITOR_FEES[method as CompetitorMethod];
    if (isScheduleStale(sched.review_by, now)) {
      warnings.push(`The estimated ${sched.where_it_sells} fee schedule (version ${sched.version}) is past its review date of ${sched.review_by} and may be out of date.`);
    }
  }

  // --- solve ---
  const base: Omit<ComputeInput, "sale_price"> = {
    quantity,
    shipping_amount: shipping,
    seller_plan: sellerPlan,
    seller_level: sellerLevel,
    seller_covers_fees: sellerCoversFees,
    ebay_store_subscription: ebayStoreSubscription,
    acquisition_cost: acquisitionCost,
    ebay_fee_percent_override: ebayOverride,
  };
  const solved = requiredSalePriceForNet(method, targetNet, base);
  const breakdown =
    solved.required_sale_price !== null
      ? computeMethod(method, { ...base, sale_price: solved.required_sale_price })
      : null;

  const netBasis: RequiredResult["net_basis"] =
    acquisitionCost !== undefined ? "net_profit_after_acquisition_cost" : "take_home_payout";

  const assumptions: string[] = [
    "All figures are estimates for trading cards in USD.",
    netBasis === "net_profit_after_acquisition_cost"
      ? "target_net is treated as net profit: the required price is solved so payout minus acquisition_cost equals the target."
      : "target_net is treated as take-home payout (no acquisition cost supplied).",
    "The required price is found by deterministic search over the same fee engine compare_selling_costs uses; Binz fixed pricing and per-order fees are honored.",
    "Payout figures exclude income taxes and any seller-specific promotions or credits.",
  ];
  if (method === "ebay") {
    assumptions.push(
      ebayOverride !== undefined
        ? "eBay fees use the user-supplied final value fee percentage (flat rate)."
        : ebayStoreSubscription
          ? "eBay fees use the eBay Store subscriber rate."
          : "eBay fees use the individual rate. Set ebay_store_subscription for Store rates.",
    );
  }
  if (isCompetitor) {
    assumptions.push(
      "Competitor estimate uses published fixed-price / Buy Now seller fees; auction formats are not modeled and the seller's own shipping-label cost is excluded.",
    );
  }

  const result: RequiredResult = {
    currency: "USD",
    method,
    target_net: targetNet,
    net_basis: netBasis,
    quantity,
    shipping_amount: shipping,
    item_category: "trading_cards",
    seller_plan: sellerPlan,
    seller_level: sellerLevel,
    required_sale_price: solved.required_sale_price,
    achieved_net: solved.achieved_net,
    reachable: solved.required_sale_price !== null,
    breakdown,
    assumptions,
    inputs_used: inputsUsed,
    fee_schedules: {
      ebay: {
        version: EBAY_FEES.version,
        effective_date: EBAY_FEES.effective_date,
        source: EBAY_FEES.source,
        source_url: EBAY_FEES.source_url,
        estimated: true,
      },
      pulltrader: {
        version: PULLTRADER_FEES.version,
        effective_date: PULLTRADER_FEES.effective_date,
        source: PULLTRADER_FEES.source,
        source_url: PULLTRADER_FEES.source_url,
        estimated: false,
      },
    },
    competitor_fee_schedule: isCompetitor
      ? (() => {
          const s = COMPETITOR_FEES[method as CompetitorMethod];
          return {
            method: method as CompetitorMethod,
            name: s.where_it_sells,
            version: s.version,
            effective_date: s.effective_date,
            source: s.source,
            source_url: s.source_url,
            estimated: true as const,
          };
        })()
      : undefined,
    fee_schedule_version: `ebay:${EBAY_FEES.version}+pulltrader:${PULLTRADER_FEES.version}`,
    warnings,
    calculated_at: now.toISOString(),
    disclaimer:
      "Estimates only, for trading cards in USD. eBay and competitor fees are estimated from published rates and exclude several conditional costs. Actual proceeds vary. This is not financial advice.",
    related_url: relatedUrl,
  };

  return { ok: true, result };
}

/** Concise, neutral human-readable summary. */
export function summarizeRequiredSalePrice(r: RequiredResult): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const label = r.breakdown?.label ?? r.method;
  const qtyNote = r.quantity > 1 ? ` (x${r.quantity})` : "";
  const basis = r.net_basis === "net_profit_after_acquisition_cost" ? "net profit" : "take-home";

  if (!r.reachable || r.required_sale_price === null) {
    return [
      `Even at the maximum supported price, ${label} can't reach a ${basis} of ${money(r.target_net)}${qtyNote} for these inputs — its payout tops out below that.`,
      r.disclaimer,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(
    `To ${basis === "net profit" ? "net a profit of" : "take home"} ${money(r.target_net)}${qtyNote} on ${label}, list at about ${money(r.required_sale_price)} per item.`,
  );
  if (r.achieved_net !== null) {
    lines.push(`At that price the estimated ${basis} is ${money(r.achieved_net)} (fees ${money(r.breakdown!.estimated_total_fees)}, ${r.breakdown!.effective_fee_rate}%).`);
  }
  lines.push(r.disclaimer);
  if (r.warnings.length > 0) lines.push(`Note: ${r.warnings.join(" ")}`);
  return lines.join("\n");
}
