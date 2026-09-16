import { describe, it, expect } from "vitest";
import type { BackendConfig } from "../src/backend/client";
import type { ToolContext } from "../src/tools/registry";
import * as identifyCard from "../src/tools/identifyCard";
import * as searchCardSales from "../src/tools/searchCardSales";
import * as summarizeCardMarket from "../src/tools/summarizeCardMarket";
import * as getCardPriceHistory from "../src/tools/getCardPriceHistory";

function backendReturning(body: unknown, status = 200): BackendConfig {
  return {
    baseUrl: "https://backend.test",
    secret: "s",
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
  };
}

function backendThrowing(name: string): BackendConfig {
  return {
    baseUrl: "https://backend.test",
    secret: "s",
    fetchImpl: (async () => {
      const e = new Error("boom");
      e.name = name;
      throw e;
    }) as unknown as typeof fetch,
  };
}

const CARD_MARKET = {
  query: "2023 Prizm Wembanyama Silver PSA 10",
  category: "basketball",
  ebay_search_url: "https://ebay.com/sch/x",
  sample_count: 7,
  has_partial_matches: false,
  dated_sales: [
    { price: 100, soldDate: "2026-01-05T00:00:00.000Z" },
    { price: 110, soldDate: "2026-01-12T00:00:00.000Z" },
    { price: 120, soldDate: "2026-01-19T00:00:00.000Z" },
    { price: 130, soldDate: "2026-01-26T00:00:00.000Z" },
    { price: 105, soldDate: "2026-02-02T00:00:00.000Z" },
    { price: 115, soldDate: "2026-02-09T00:00:00.000Z" },
    { price: 5000, soldDate: "2026-02-16T00:00:00.000Z" }, // outlier
  ],
  example_sales: [
    { title: "Wembanyama Silver PSA 10", price: 120, sold_date: "2026-01-19T00:00:00.000Z" },
    { title: "Wembanyama Silver PSA 10 b", price: 110, sold_date: "2026-01-12T00:00:00.000Z" },
  ],
  reference_stats: { sample_count: 7, median: 115, mean: 811.4, low: 100, high: 5000, std_dev: 1700, last_sold_date: "2026-02-16T00:00:00.000Z" },
  tcg_price_history: null,
  data_freshness: { last_sold_date: "2026-02-16T00:00:00.000Z", retrieved_at: "2026-02-20T00:00:00.000Z" },
  disclaimer: "Limited public market data. Not financial advice.",
};

const ctx = (backend?: BackendConfig): ToolContext => ({ now: new Date("2026-02-20T00:00:00Z"), backend });

describe("identify_card", () => {
  it("requires a query", async () => {
    const out = await identifyCard.run({}, ctx(backendReturning({})));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("INVALID_INPUT");
  });
  it("maps a backend identity into structured + text", async () => {
    const backend = backendReturning({
      query: "q",
      category: "basketball",
      identity: { player_athlete: "Victor Wembanyama", year: "2023", set_name: "Prizm", card_number: "136", parallel: "Silver", grader: "PSA", grade: "10", sport: "basketball" },
      fields_extracted: 8,
      confidence: "high",
    });
    const out = await identifyCard.run({ query: "2023 Prizm Wemby Silver PSA 10" }, ctx(backend));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.structured as any).identity.player_athlete).toBe("Victor Wembanyama");
      expect(out.text).toContain("Victor Wembanyama");
      expect(out.text).toContain("confidence high");
    }
  });
  it("returns DATA_BACKEND_UNAVAILABLE when unconfigured", async () => {
    const out = await identifyCard.run({ query: "anything" }, ctx(undefined));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("DATA_BACKEND_UNAVAILABLE");
  });
});

describe("search_card_sales", () => {
  it("computes canonical stats (IQR removes the outlier) and caps examples", async () => {
    const out = await searchCardSales.run({ query: "wemby", limit: 2 }, ctx(backendReturning(CARD_MARKET)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      const s = out.structured as any;
      expect(s.market.sample_count).toBe(6); // 7 inputs, 1 IQR outlier removed
      expect(s.market.median).toBeGreaterThan(100);
      expect(s.market.median).toBeLessThan(140);
      expect(s.market.high).toBe(130); // outlier (5000) excluded from kept set
      expect(s.sales).toHaveLength(2);
      // Per-listing affiliate/image URLs must never appear in the sales sample.
      expect(JSON.stringify(s.sales)).not.toContain("http");
      // The generic eBay search URL is allowed as a provenance link.
      expect(s.ebay_search_url).toBe("https://ebay.com/sch/x");
    }
  });
  it("validates limit bounds", async () => {
    const out = await searchCardSales.run({ query: "x", limit: 99 }, ctx(backendReturning(CARD_MARKET)));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("INVALID_INPUT");
  });
  it("handles an empty market gracefully", async () => {
    const empty = { ...CARD_MARKET, sample_count: 0, dated_sales: [], example_sales: [] };
    const out = await searchCardSales.run({ query: "obscure" }, ctx(backendReturning(empty)));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text.toLowerCase()).toContain("no recent sold comps");
  });
  it("surfaces a vendor (JustTCG/CardSightAI) value when there are no dated comps", async () => {
    const tcg = {
      ...CARD_MARKET,
      query: "Charizard ex",
      sample_count: 0,
      dated_sales: [],
      example_sales: [],
      market_value: 412.5,
      value_source: "TCG Market",
      image: "https://product-images.tcgplayer.com/fit-in/437x437/1.jpg",
    };
    const out = await searchCardSales.run({ query: "charizard ex" }, ctx(backendReturning(tcg)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text.toLowerCase()).toContain("current market value is available");
      expect(out.text).toContain("$412.50");
      expect((out.structured as any).market_value).toBe(412.5);
      expect((out.structured as any).value_source).toBe("TCG Market");
      expect((out.structured as any).image).toContain("tcgplayer.com");
    }
  });
  it("leads with the vendor value for a raw card even when eBay comps exist", async () => {
    const raw = { ...CARD_MARKET, is_graded: false, market_value: 95, value_source: "CardSightAI", image: "https://cardsight/x.jpg" };
    const out = await searchCardSales.run({ query: "wemby raw" }, ctx(backendReturning(raw)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain("Market value");
      expect(out.text).toContain("$95.00");
      expect(out.text).toContain("(CardSightAI)");
      expect(out.text.toLowerCase()).toContain("reference");
      expect((out.structured as any).is_graded).toBe(false);
    }
  });
  it("leads with eBay comps for a graded card (value_source eBay Comps)", async () => {
    const graded = { ...CARD_MARKET, is_graded: true, market_value: 115, value_source: "eBay Comps" };
    const out = await searchCardSales.run({ query: "wemby psa 10" }, ctx(backendReturning(graded)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text.toLowerCase()).toContain("recent sold comp");
      expect((out.structured as any).is_graded).toBe(true);
    }
  });
});

describe("summarize_card_market", () => {
  it("returns a canonical summary with percentiles + confidence", async () => {
    const out = await summarizeCardMarket.run({ query: "wemby" }, ctx(backendReturning(CARD_MARKET)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      const s = (out.structured as any).summary;
      expect(s.sampleCount).toBe(6);
      expect(s.outliersRemoved).toBe(1);
      expect(s.p10).not.toBeNull();
      expect(s.p90).not.toBeNull();
      expect(["high", "medium", "low"]).toContain(s.confidence);
      expect((out.structured as any).reference_stats.median).toBe(115);
    }
  });
  it("requires query or item", async () => {
    const out = await summarizeCardMarket.run({}, ctx(backendReturning(CARD_MARKET)));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("INVALID_INPUT");
  });
  it("reports a vendor market value when there are no dated comps", async () => {
    const tcg = {
      ...CARD_MARKET,
      query: "Pikachu",
      sample_count: 0,
      dated_sales: [],
      example_sales: [],
      market_value: 50,
      value_source: "TCG Market",
      price_change_7d: 2.5,
    };
    const out = await summarizeCardMarket.run({ query: "pikachu" }, ctx(backendReturning(tcg)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain("Market value");
      expect(out.text).toContain("$50.00");
      expect(out.text).toContain("TCG Market");
      expect((out.structured as any).market_value).toBe(50);
    }
  });
  it("leads with the vendor value for a raw card and shows eBay comps as reference", async () => {
    const raw = { ...CARD_MARKET, is_graded: false, market_value: 95, value_source: "CardSightAI" };
    const out = await summarizeCardMarket.run({ query: "wemby raw" }, ctx(backendReturning(raw)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain("Market value");
      expect(out.text).toContain("$95.00");
      expect(out.text).toContain("(CardSightAI)");
      expect(out.text.toLowerCase()).toContain("reference");
      expect((out.structured as any).is_graded).toBe(false);
    }
  });
});

describe("get_card_price_history", () => {
  it("builds a weekly series with a trend", async () => {
    const out = await getCardPriceHistory.run({ query: "wemby", interval: "week" }, ctx(backendReturning(CARD_MARKET)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      const s = out.structured as any;
      expect(s.interval).toBe("week");
      expect(Array.isArray(s.series)).toBe(true);
      expect(s.series.length).toBeGreaterThan(0);
      expect(s.sample_count).toBe(7); // all dated sales used for bucketing
      expect(["up", "down", "flat"]).toContain(s.trend.direction);
      expect(s.source).toBe("pulltrader_sold_comps");
    }
  });
  it("rejects an invalid interval", async () => {
    const out = await getCardPriceHistory.run({ query: "x", interval: "year" }, ctx(backendReturning(CARD_MARKET)));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("INVALID_INPUT");
  });
});

describe("backend error mapping", () => {
  it("maps 404 to NOT_FOUND", async () => {
    const out = await summarizeCardMarket.run({ query: "x" }, ctx(backendReturning({ error: "nope" }, 404)));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("NOT_FOUND");
  });
  it("maps 429 to RATE_LIMITED", async () => {
    const out = await summarizeCardMarket.run({ query: "x" }, ctx(backendReturning({ error: "slow down" }, 429)));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("RATE_LIMITED");
  });
  it("maps 500 to UPSTREAM_ERROR", async () => {
    const out = await summarizeCardMarket.run({ query: "x" }, ctx(backendReturning({ error: "boom" }, 500)));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UPSTREAM_ERROR");
  });
  it("maps an abort to UPSTREAM_TIMEOUT", async () => {
    const out = await summarizeCardMarket.run({ query: "x" }, ctx(backendThrowing("AbortError")));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UPSTREAM_TIMEOUT");
  });
});
