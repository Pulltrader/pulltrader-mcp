// =============================================================================
// TOOL: explain_selling_method
// =============================================================================
// Plain, structured explanation of how each supported selling/fulfillment method
// works and what fees apply. Derived from the canonical fee engine + schedules so
// the explanation never drifts from compare_selling_costs. No pricing/market data.
// =============================================================================

import { toolError, type ToolError } from "../errors";
import {
  COMPETITOR_FEES,
  EBAY_FEES,
  PULLTRADER_FEES,
  type CompetitorMethod,
} from "../fees/schedule";
import {
  computeMethod,
  COMPETITOR_METHODS,
  SUPPORTED_METHODS,
  type ComputeInput,
  type SellingMethod,
} from "../fees/calculator";

export const TOOL_NAME = "explain_selling_method";

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: "Explain how a supported selling method works and what fees apply",
  description:
    "Return a plain, structured explanation of one or more supported trading-card selling methods: who owns the listing, who fulfills, where it sells, the fee components that apply, and important caveats. " +
    "Covers eBay (estimated), Pulltrader marketplace, Fulfilled by Pulltrader, branded storefront, in-person POS, and estimated competitor marketplaces (TCGplayer, Mana Pool, Misprint, Fanatics Collect, Goldin). " +
    "Use this when a seller asks how a method works, what fees a platform charges, or how Pulltrader selling options differ. " +
    "Do NOT use this to compute a specific payout (use compare_selling_costs) or the price needed for a target net (use calculate_required_sale_price), and do NOT use it to price cards.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      methods: {
        type: "array",
        items: { type: "string", enum: SUPPORTED_METHODS },
        uniqueItems: true,
        description:
          "Which selling methods to explain. Defaults to all supported methods: ebay, pulltrader_marketplace, pulltrader_fbp, pulltrader_storefront, pulltrader_pos, tcgplayer, manapool, misprint, fanatics_collect, goldin.",
      },
    },
  },
} as const;

export interface ExplainSuccess {
  ok: true;
  result: ExplainResult;
}
export interface ExplainFailure {
  ok: false;
  error: ToolError;
}
export type ExplainOutcome = ExplainSuccess | ExplainFailure;

export interface MethodExplanation {
  method: SellingMethod;
  label: string;
  where_it_sells: string;
  owns_listing: "seller" | "pulltrader";
  fulfilled_by: "seller" | "pulltrader";
  estimated: boolean;
  summary: string;
  fee_components: Array<{ component: string; kind: "percentage" | "fixed"; paid_by: "seller" | "buyer" }>;
  notes: string[];
  fee_schedule: { version: string; effective_date: string; source: string; source_url: string };
}

export interface ExplainResult {
  methods: MethodExplanation[];
  disclaimer: string;
  related_url: string;
  calculated_at: string;
}

type RawArgs = Record<string, unknown>;

function isPlainObject(v: unknown): v is RawArgs {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface ComputeOptions {
  now?: Date;
  relatedUrl?: string;
}

function scheduleFor(method: SellingMethod): MethodExplanation["fee_schedule"] {
  if (method === "ebay") {
    return {
      version: EBAY_FEES.version,
      effective_date: EBAY_FEES.effective_date,
      source: EBAY_FEES.source,
      source_url: EBAY_FEES.source_url,
    };
  }
  if ((COMPETITOR_METHODS as string[]).includes(method)) {
    const s = COMPETITOR_FEES[method as CompetitorMethod];
    return { version: s.version, effective_date: s.effective_date, source: s.source, source_url: s.source_url };
  }
  return {
    version: PULLTRADER_FEES.version,
    effective_date: PULLTRADER_FEES.effective_date,
    source: PULLTRADER_FEES.source,
    source_url: PULLTRADER_FEES.source_url,
  };
}

// A representative, price-agnostic input used only to derive the structural
// description (labels, fee components, notes) from the canonical engine. The
// dollar amounts are intentionally discarded — only structure is surfaced.
const SAMPLE_INPUT: ComputeInput = {
  sale_price: 50,
  quantity: 1,
  shipping_amount: 0,
  seller_plan: "free",
  seller_covers_fees: false,
  ebay_store_subscription: false,
};

function explainOne(method: SellingMethod): MethodExplanation {
  const r = computeMethod(method, SAMPLE_INPUT);
  const summary =
    `${r.label}. Sells on ${r.where_it_sells}; the listing is owned by ${r.owns_listing} and the item is fulfilled by ${r.fulfilled_by}.` +
    (r.estimated ? " Fees for this method are estimated from published rates." : " Fees are exact for Pulltrader.");
  return {
    method,
    label: r.label,
    where_it_sells: r.where_it_sells,
    owns_listing: r.owns_listing,
    fulfilled_by: r.fulfilled_by,
    estimated: r.estimated,
    summary,
    fee_components: r.fee_breakdown.map((f) => ({ component: f.label, kind: f.kind, paid_by: f.paid_by })),
    notes: r.notes,
    fee_schedule: scheduleFor(method),
  };
}

export function explainSellingMethod(args: unknown, options: ComputeOptions = {}): ExplainOutcome {
  const now = options.now ?? new Date();
  const relatedUrl = options.relatedUrl ?? "https://pulltrader.app/sell";

  let methods: SellingMethod[] = [...SUPPORTED_METHODS];

  if (args !== undefined && args !== null) {
    if (!isPlainObject(args)) {
      return { ok: false, error: toolError("INVALID_INPUT", "Arguments must be an object.") };
    }
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
    }
  }

  const result: ExplainResult = {
    methods: methods.map(explainOne),
    disclaimer:
      "Educational overview of how each method charges fees. eBay and competitor methods are estimated from published rates and may change. Use compare_selling_costs for specific payout estimates. Not financial advice.",
    related_url: relatedUrl,
    calculated_at: now.toISOString(),
  };

  return { ok: true, result };
}

/** Concise human-readable summary. */
export function summarizeExplain(r: ExplainResult): string {
  const lines: string[] = ["How these trading-card selling methods work:"];
  for (const m of r.methods) {
    const components = m.fee_components.map((f) => f.component).join("; ");
    lines.push(`- ${m.label} (${m.where_it_sells})${m.estimated ? " [estimated]" : ""}: ${components || "no seller fees"}.`);
  }
  lines.push(r.disclaimer);
  return lines.join("\n");
}
