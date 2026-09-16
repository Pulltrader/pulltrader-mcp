import { describe, it, expect } from "vitest";
import { explainSellingMethod } from "../src/tools/explainSellingMethod";
import { SUPPORTED_METHODS } from "../src/fees/calculator";

const now = new Date("2026-06-27T12:00:00Z");

describe("explain_selling_method", () => {
  it("explains all supported methods by default", () => {
    const out = explainSellingMethod(undefined, { now });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.methods).toHaveLength(SUPPORTED_METHODS.length);
    for (const m of out.result.methods) {
      expect(m.fee_schedule.source_url).toMatch(/^https?:\/\//);
      expect(Array.isArray(m.notes)).toBe(true);
    }
  });

  it("filters to requested methods and dedupes", () => {
    const out = explainSellingMethod({ methods: ["ebay", "ebay", "goldin"] }, { now });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.methods.map((m) => m.method)).toEqual(["ebay", "goldin"]);
  });

  it("marks eBay and competitors as estimated, Pulltrader methods as exact", () => {
    const out = explainSellingMethod(
      { methods: ["ebay", "tcgplayer", "pulltrader_storefront"] },
      { now },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const byMethod = Object.fromEntries(out.result.methods.map((m) => [m.method, m]));
    expect(byMethod.ebay!.estimated).toBe(true);
    expect(byMethod.tcgplayer!.estimated).toBe(true);
    expect(byMethod.pulltrader_storefront!.estimated).toBe(false);
  });

  it("rejects an unsupported method", () => {
    const out = explainSellingMethod({ methods: ["webuy"] }, { now });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UNSUPPORTED_SELLING_METHOD");
  });

  it("rejects an empty methods array", () => {
    const out = explainSellingMethod({ methods: [] }, { now });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("INVALID_INPUT");
  });
});
