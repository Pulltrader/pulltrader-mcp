// =============================================================================
// TOOL: compare_selling_costs
// =============================================================================

import { toolError, type ToolError } from "../errors";
import {
  COMPETITOR_FEES,
  EBAY_FEES,
  PULLTRADER_FEES,
  isScheduleStale,
  type CompetitorMethod,
  type SellerPlan,
} from "../fees/schedule";
import {
  computeMethod,
  round2,
  COMPETITOR_METHODS,
  DEFAULT_METHODS,
  SUPPORTED_METHODS,
  type MethodResult,
  type SellingMethod,
} from "../fees/calculator";

export const TOOL_NAME = "compare_selling_costs";

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: "Compare trading-card seller proceeds across selling methods",
  description:
    "Compare estimated fees and the net amount a trading-card seller keeps when selling the SAME card across eBay (estimated), Pulltrader selling methods (marketplace, Fulfilled by Pulltrader, branded storefront, and in-person POS), and other marketplaces (TCGplayer, Mana Pool, Misprint, Fanatics Collect, Goldin — estimated fixed-price/Buy Now seller fees). " +
    "Use this when a seller asks what they would keep/net/take-home on a sale, how fees compare between platforms, or which method leaves them with more money. " +
    "Calculations are deterministic and use dated fee schedules. " +
    "Competitor marketplaces are off by default; include them via the `methods` field. Only fixed-price seller fees are modeled — auction formats (hammer price, buyer's premium, negotiated consignment) are not. " +
    "Do NOT use this to look up a card's market value or recent sales (this tool does not price cards), and do NOT use it for non-trading-card categories. " +
    "Present competitor and eBay figures as estimates, never as guaranteed proceeds, and never claim one platform is universally cheapest.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sale_price: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: 1_000_000,
        description: "The per-item sale price (the card's listed/sold price), in the given currency.",
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
        description:
          "Shipping amount charged to the buyer. Affects eBay's fee base. See assumptions for how each method treats shipping.",
      },
      item_category: {
        type: "string",
        enum: ["trading_cards"],
        default: "trading_cards",
        description: "Item category. Only trading_cards is supported.",
      },
      seller_plan: {
        type: "string",
        enum: ["free", "starter", "pro", "shop"],
        default: "free",
        description:
          "Pulltrader seller plan. Determines the marketplace payout tier (free=91%, starter=93%, pro=94%, shop=95%).",
      },
      seller_covers_fees: {
        type: "boolean",
        default: false,
        description:
          "If true, the seller absorbs the Pulltrader platform fee (3.25% + $0.40). If false (default), the buyer pays it at checkout. The platform fee is always charged on Pulltrader card sales regardless.",
      },
      ebay_store_subscription: {
        type: "boolean",
        default: false,
        description:
          "If true, estimate eBay fees using the eBay Store subscriber rate (12.35% up to $2,500/item) instead of the individual rate (13.25% up to $7,500/item).",
      },
      methods: {
        type: "array",
        items: { type: "string", enum: SUPPORTED_METHODS },
        uniqueItems: true,
        description:
          "Which selling methods to compare. Defaults to eBay, Pulltrader marketplace, and Pulltrader storefront. " +
          "Other supported methods (off by default): pulltrader_fbp, pulltrader_pos, and estimated competitor marketplaces tcgplayer, manapool, misprint, fanatics_collect, goldin.",
      },
      acquisition_cost: {
        type: "number",
        minimum: 0,
        maximum: 1_000_000,
        description: "Optional. What the seller paid for the card; used to estimate net profit per method.",
      },
      ebay_fee_percent_override: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description:
          "Optional. Override the estimated eBay final value fee percentage (e.g. for a seller with an eBay Store subscription).",
      },
    },
    required: ["sale_price"],
  },
} as const;

export interface CompareSuccess {
  ok: true;
  result: CompareResult;
}
export interface CompareFailure {
  ok: false;
  error: ToolError;
}
export type CompareOutcome = CompareSuccess | CompareFailure;

export interface CompareResult {
  currency: "USD";
  sale_price: number;
  quantity: number;
  shipping_amount: number;
  item_category: "trading_cards";
  seller_plan: SellerPlan;
  baseline_method: SellingMethod;
  methods: MethodResult[];
  difference_from_baseline: Array<{ method: SellingMethod; amount: number }>;
  best_for_seller: SellingMethod;
  assumptions: string[];
  inputs_used: Array<{ field: string; value: string | number | boolean; source: "provided" | "default" }>;
  fee_schedules: {
    ebay: { version: string; effective_date: string; source: string; source_url: string; estimated: true };
    pulltrader: { version: string; effective_date: string; source: string; source_url: string; estimated: false };
  };
  /** Provenance for any competitor marketplaces included in this comparison. */
  competitor_fee_schedules?: Array<{
    method: CompetitorMethod;
    name: string;
    version: string;
    effective_date: string;
    source: string;
    source_url: string;
    estimated: true;
  }>;
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

/**
 * Validate args and compute the comparison. Pure aside from `now`/`relatedUrl`,
 * which are injected so the function stays deterministic and testable.
 */
export function compareSellingCosts(args: unknown, options: ComputeOptions = {}): CompareOutcome {
  const now = options.now ?? new Date();
  const relatedUrl = options.relatedUrl ?? "https://pulltrader.app/sell";

  if (!isPlainObject(args)) {
    return { ok: false, error: toolError("INVALID_INPUT", "Arguments must be an object.") };
  }

  const inputsUsed: CompareResult["inputs_used"] = [];
  const track = (field: string, value: string | number | boolean, provided: boolean) =>
    inputsUsed.push({ field, value, source: provided ? "provided" : "default" });

  // --- sale_price (required) ---
  const salePrice = asFiniteNumber(args.sale_price);
  if (salePrice === null) {
    return { ok: false, error: toolError("INVALID_INPUT", "sale_price is required and must be a finite number.", "sale_price") };
  }
  if (salePrice <= 0) {
    return { ok: false, error: toolError("INVALID_INPUT", "sale_price must be greater than 0.", "sale_price") };
  }
  if (salePrice > 1_000_000) {
    return { ok: false, error: toolError("INVALID_INPUT", "sale_price exceeds the supported maximum (1,000,000).", "sale_price") };
  }
  track("sale_price", salePrice, true);

  // --- currency ---
  let currency: "USD" = "USD";
  if (args.currency !== undefined) {
    if (typeof args.currency !== "string") {
      return { ok: false, error: toolError("INVALID_INPUT", "currency must be a string.", "currency") };
    }
    if (args.currency.toUpperCase() !== "USD") {
      return { ok: false, error: toolError("UNSUPPORTED_CURRENCY", `Currency '${args.currency}' is not supported. Only USD is available.`, "currency") };
    }
    currency = "USD";
    track("currency", currency, true);
  } else {
    track("currency", currency, false);
  }

  // --- item_category ---
  let category: "trading_cards" = "trading_cards";
  if (args.item_category !== undefined) {
    if (typeof args.item_category !== "string") {
      return { ok: false, error: toolError("INVALID_INPUT", "item_category must be a string.", "item_category") };
    }
    if (args.item_category !== "trading_cards") {
      return { ok: false, error: toolError("UNSUPPORTED_CATEGORY", `Category '${args.item_category}' is not supported. Only trading_cards is available.`, "item_category") };
    }
    track("item_category", category, true);
  } else {
    track("item_category", category, false);
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
  const validPlans: SellerPlan[] = ["free", "starter", "pro", "shop"];
  let sellerPlan: SellerPlan = "free";
  if (args.seller_plan !== undefined) {
    if (typeof args.seller_plan !== "string" || !validPlans.includes(args.seller_plan as SellerPlan)) {
      return { ok: false, error: toolError("INVALID_INPUT", `seller_plan must be one of: ${validPlans.join(", ")}.`, "seller_plan") };
    }
    sellerPlan = args.seller_plan as SellerPlan;
    track("seller_plan", sellerPlan, true);
  } else {
    track("seller_plan", sellerPlan, false);
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

  // --- methods ---
  let methods: SellingMethod[] = DEFAULT_METHODS;
  if (args.methods !== undefined) {
    if (!Array.isArray(args.methods) || args.methods.length === 0) {
      return { ok: false, error: toolError("INVALID_INPUT", "methods must be a non-empty array.", "methods") };
    }
    const seen = new Set<string>();
    const parsed: SellingMethod[] = [];
    for (const m of args.methods) {
      if (typeof m !== "string" || !SUPPORTED_METHODS.includes(m as SellingMethod)) {
        return { ok: false, error: toolError("UNSUPPORTED_SELLING_METHOD", `Unsupported selling method '${String(m)}'. Supported: ${SUPPORTED_METHODS.join(", ")}.`, "methods") };
      }
      if (!seen.has(m)) {
        seen.add(m);
        parsed.push(m as SellingMethod);
      }
    }
    methods = parsed;
    track("methods", methods.join(","), true);
  } else {
    track("methods", methods.join(","), false);
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

  // --- freshness check ---
  const warnings: string[] = [];
  if (methods.includes("ebay") && isScheduleStale(EBAY_FEES.review_by, now)) {
    warnings.push(
      `The estimated eBay fee schedule (version ${EBAY_FEES.version}) is past its review date of ${EBAY_FEES.review_by} and may be out of date.`,
    );
  }
  if (isScheduleStale(PULLTRADER_FEES.review_by, now)) {
    warnings.push(
      `The Pulltrader fee schedule (version ${PULLTRADER_FEES.version}) is past its review date of ${PULLTRADER_FEES.review_by} and may be out of date.`,
    );
  }
  const competitorMethodsUsed = methods.filter((m): m is CompetitorMethod =>
    (COMPETITOR_METHODS as string[]).includes(m),
  );
  for (const cm of competitorMethodsUsed) {
    const sched = COMPETITOR_FEES[cm];
    if (isScheduleStale(sched.review_by, now)) {
      warnings.push(
        `The estimated ${sched.where_it_sells} fee schedule (version ${sched.version}) is past its review date of ${sched.review_by} and may be out of date.`,
      );
    }
  }

  // --- compute ---
  const computeInput = {
    sale_price: salePrice,
    quantity,
    shipping_amount: shipping,
    seller_plan: sellerPlan,
    seller_covers_fees: sellerCoversFees,
    ebay_store_subscription: ebayStoreSubscription,
    acquisition_cost: acquisitionCost,
    ebay_fee_percent_override: ebayOverride,
  };
  const methodResults = methods.map((m) => computeMethod(m, computeInput));

  // Baseline = eBay when present (the external comparison), else the first method.
  const baseline = methods.includes("ebay") ? "ebay" : methods[0]!;
  const baselineResult = methodResults.find((r) => r.method === baseline)!;
  const diffs = methodResults.map((r) => ({
    method: r.method,
    amount: round2(r.estimated_payout - baselineResult.estimated_payout),
  }));
  const bestForSeller = methodResults.reduce((best, r) => (r.estimated_payout > best.estimated_payout ? r : best), methodResults[0]!).method;

  const assumptions: string[] = [
    "All figures are estimates for trading cards in USD.",
    ebayOverride !== undefined
      ? "eBay fees use the user-supplied final value fee percentage (flat rate)."
      : ebayStoreSubscription
        ? "eBay fees use the eBay Store subscriber rate (12.35% up to $2,500 per item, then 2.35%)."
        : "eBay fees use the individual rate (13.25% up to $7,500 per item, then 2.35%). Set ebay_store_subscription for Store rates.",
    "eBay per-order fee is $0.30 for orders \u2264 $10 and $0.40 otherwise; eBay figures exclude promoted listings, international fees, sales tax, and the seller's own shipping-label cost.",
    "Pulltrader's platform fee (3.25% + $0.40) is always charged on card sales. " +
      (sellerCoversFees
        ? "The seller is treated as covering it, so it is deducted from the payout."
        : "By default the buyer pays it at checkout, so it is not deducted from the seller."),
    "Pulltrader's seller fee (commission) applies only to marketplace and Fulfilled by Pulltrader sales. Storefront and POS sales have no seller fee — the seller keeps the full item price (cash POS has no fees at all).",
    "On marketplace and FBP, payout is a percentage of the item subtotal; shipping is handled by Pulltrader and does not change the item payout. Binz fixed pricing applies automatically for qualifying low prices.",
    "There are no per-item listing fees on Pulltrader.",
    "Payout figures exclude income taxes and any seller-specific promotions or credits.",
  ];
  if (competitorMethodsUsed.length > 0) {
    assumptions.push(
      "Competitor marketplaces (TCGplayer, Mana Pool, Misprint, Fanatics Collect, Goldin) use estimated fixed-price / Buy Now seller fees from each platform's published schedule, with representative rates. Auction formats (hammer price, buyer's premium, negotiated consignment) are not modeled. Each competitor estimate excludes the seller's own shipping-label cost.",
    );
  }

  const result: CompareResult = {
    currency,
    sale_price: salePrice,
    quantity,
    shipping_amount: shipping,
    item_category: category,
    seller_plan: sellerPlan,
    baseline_method: baseline,
    methods: methodResults,
    difference_from_baseline: diffs,
    best_for_seller: bestForSeller,
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
    competitor_fee_schedules:
      competitorMethodsUsed.length > 0
        ? competitorMethodsUsed.map((cm) => {
            const s = COMPETITOR_FEES[cm];
            return {
              method: cm,
              name: s.where_it_sells,
              version: s.version,
              effective_date: s.effective_date,
              source: s.source,
              source_url: s.source_url,
              estimated: true as const,
            };
          })
        : undefined,
    fee_schedule_version: `ebay:${EBAY_FEES.version}+pulltrader:${PULLTRADER_FEES.version}`,
    warnings,
    calculated_at: now.toISOString(),
    disclaimer:
      "Estimates only, for trading cards in USD. eBay fees are estimated from published rates and exclude several conditional costs. Actual proceeds vary. This is not financial advice.",
    related_url: relatedUrl,
  };

  return { ok: true, result };
}

/** Concise, neutral human-readable summary. Never claims universal superiority. */
export function summarizeComparison(r: CompareResult): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const labelFor = (m: SellingMethod) => r.methods.find((x) => x.method === m)?.label ?? m;

  const lines: string[] = [];
  const qtyNote = r.quantity > 1 ? ` (x${r.quantity})` : "";
  lines.push(
    `On a ${money(r.sale_price)}${qtyNote} trading-card sale, estimated seller proceeds by method:`,
  );
  for (const m of r.methods) {
    const est = m.estimated ? " (estimated)" : "";
    const profit = m.estimated_net_profit !== undefined ? `, est. profit ${money(m.estimated_net_profit)}` : "";
    lines.push(
      `- ${m.label}: keep ${money(m.estimated_payout)}${est} (fees ${money(m.estimated_total_fees)}, ${m.effective_fee_rate}%)${profit}`,
    );
  }

  const best = r.methods.find((m) => m.method === r.best_for_seller)!;
  const baseline = r.methods.find((m) => m.method === r.baseline_method)!;
  if (best.method !== baseline.method) {
    const diff = round2(best.estimated_payout - baseline.estimated_payout);
    if (diff > 0) {
      lines.push(
        `For these inputs, ${best.label} returns about ${money(diff)} more than ${baseline.label}.`,
      );
    }
  }
  lines.push(
    `Estimate based on fee schedules updated ${r.fee_schedules.pulltrader.effective_date} (Pulltrader) and ${r.fee_schedules.ebay.effective_date} (eBay, estimated). ${r.disclaimer}`,
  );
  if (r.warnings.length > 0) lines.push(`Note: ${r.warnings.join(" ")}`);
  return lines.join("\n");
}
