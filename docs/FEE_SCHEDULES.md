# Fee schedules & update process

All fee values live in **one file**: [`src/fees/schedule.ts`](https://github.com/Pulltrader/pulltrader-app/blob/master/cloudflare-workers/pulltrader-mcp/src/fees/schedule.ts). Nothing else hard-codes a fee.

## Two schedules

### Pulltrader — authoritative

Mirrors Pulltrader's authoritative internal fee configuration. Pulltrader has **two** fees and **no per-item listing fee**:

1. **Seller fee (commission)** — applies to **marketplace and Fulfilled by Pulltrader only**. Determined by plan: free keeps 91%, starter 93%, pro 94%, shop 95% of the item (seller levels 1/3/4/5). **Storefront and POS have no seller fee** — the seller keeps the full item price.
2. **Platform fee** — **3.25% + $0.40, always charged** on card sales (marketplace, FBP, storefront, POS card) on the settled order total (item + shipping + tax). By default the **buyer** pays it at checkout; the seller can choose to cover it. **Cash POS has no fees at all.**

Other authoritative rules used by the engine:

* External (synced eBay consignment) flat rate: 85% (not currently exposed as a comparison method).
* Binz fixed pricing for qualifying low item prices on marketplace/FBP.

> ⚠️ Do **not** change Pulltrader values here without first changing Pulltrader's authoritative fee configuration. These are a mirror, not the source.

### eBay — estimated

A directional estimate of eBay's published trading-card selling fees, applied to the total sale amount (item + shipping), calculated per item:

* **Individual (no Store subscription):** 13.25% up to $7,500 per item, then 2.35% on the portion above.
* **eBay Store subscriber** (`ebay_store_subscription: true`): 12.35% up to $2,500 per item, then 2.35% above.
* **Per-order fee (all accounts):** $0.30 for orders ≤ $10.00, otherwise $0.40.
* Explicitly **excludes**: promoted listings, international fees, buyer-paid sales tax, below-standard performance surcharges, and the seller's own shipping-label cost.
* Callers can override the FVF % via `ebay_fee_percent_override` (flat rate; tiers ignored).

### Competitor marketplaces — estimated (opt-in)

`COMPETITOR_FEES` holds estimated **fixed-price / Buy Now** seller fees for other platforms. They are **off by default** and included only when requested via the `methods` field. Each entry has its own `source`, `source_url`, `effective_date`, `review_by`, and `conditional_notes`, and is marked `estimated: true`.

| Method             | Representative seller fee                  | Processing                 | Commission base | Notes                                                 |
| ------------------ | ------------------------------------------ | -------------------------- | --------------- | ----------------------------------------------------- |
| `tcgplayer`        | 10.75% (Level 1-4), capped $75/item        | 2.5% + $0.30               | item            | Pro/Sync 9.25% + 2.5% Pro fee; <$2.49 special rule    |
| `manapool`         | 5% on item only                            | 2.9% + $0.30 (whole order) | item            | Magic: The Gathering only                             |
| `misprint`         | 7% (base)                                  | 3% + $0.30                 | item + shipping | Lower at higher seller levels; Pokémon/graded focus   |
| `fanatics_collect` | 6% Buy Now                                 | none (all-in)              | item            | 15% if priced well above market; auctions not modeled |
| `goldin`           | tiered 16.7% / 12.5% / 10% / 8.3% by price | none (all-in)              | item            | >$250k negotiated; auctions add 22% buyer premium     |

> Auction formats (hammer price + buyer's premium + negotiated consignment) are **not** modeled — only the fixed-price seller fee. The seller's own shipping-label cost is excluded for every competitor.

## Freshness / staleness

Each schedule has `effective_date` and `review_by`. When the current date is past `review_by`, every response includes a `warnings[]` entry. This prevents a stale schedule from silently staying active. Competitor schedules are checked the same way, but only when that competitor method is part of the comparison.

## Update procedure

1. Confirm the new value against the authoritative source (Pulltrader's fee configuration for Pulltrader; eBay's published fee page for eBay) and note the source + date.
2. Edit `src/fees/schedule.ts`: update the value, bump `version`, set a new `effective_date` and a future `review_by`.
3. Update the boundary tests in `test/` if a documented example changes.
4. Bump `package.json` and `server.json` versions; add a `CHANGELOG.md` entry.
5. `npm run typecheck && npm test`.
6. Deploy (with approval) and, if the listing metadata changed, re-publish registry/Smithery entries.

## Confirmed by product (2026-06-27)

* **eBay fees** confirmed: tiered individual 13.25% / $7,500 and Store 12.35% / $2,500 (then 2.35%), per-order fee $0.30 (≤ $10) / $0.40 (> $10). Encoded above.
* **No managed-listing "$1/item" fee** — Pulltrader has no per-item listing fee. Confirmed not charged.
* **Platform fee is always charged** (buyer by default, seller optional); **no seller fee on storefront/POS**; **no fees on cash POS**.

## Remaining notes

* Shipping is modeled only in eBay's fee base; the seller's own shipping-label cost is excluded (documented). Revisit if sellers want label costs subtracted for self-fulfilled methods.
