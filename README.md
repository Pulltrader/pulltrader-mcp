# Pulltrader Seller Economics MCP

> Compare what a trading-card seller keeps across eBay and Pulltrader selling methods — inside your AI assistant.

A public, read-only [Model Context Protocol](https://modelcontextprotocol.io) server that estimates the **net amount a trading-card seller keeps** when selling the same card through eBay versus Pulltrader's selling methods (marketplace, Fulfilled by Pulltrader, branded storefront, and in-person POS).

Calculations are **deterministic** and use a **dated, versioned fee schedule**. The server performs the math itself — it never asks the model to infer fees from prose. eBay figures are clearly labeled **estimates**.

- **Transport:** Streamable HTTP (`POST /mcp`)
- **Auth:** none (public, read-only)
- **Endpoint:** `https://mcp.pulltrader.app/mcp`
- **Registry name:** `app.pulltrader/seller-economics`

## Who it's for

Trading-card sellers, dealers, and shops deciding where to list a card and how much they'll take home — especially while comparing eBay against alternatives.

## What it does (and doesn't)

| Does | Doesn't |
|---|---|
| Estimate seller fees & net proceeds per method | Look up a card's market value or recent sales |
| Compare eBay (estimated) vs Pulltrader methods | Identify a card from text or image |
| Compute the price needed for a target net (via inputs) | Make any write/account changes |
| State its assumptions and limitations explicitly | Claim one platform is universally cheapest |

> Card identification, comparable sales, and "what's it worth" are **out of scope** for this server (see [ROADMAP](#roadmap)).

## Tools

### `compare_selling_costs`

Compare estimated fees and seller net proceeds for one trading-card sale across selling methods.

**Inputs**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `sale_price` | number | ✅ | — | Per-item price, > 0 |
| `currency` | enum `USD` | | `USD` | Only USD supported |
| `quantity` | integer | | `1` | Per-order fixed fees applied once |
| `shipping_amount` | number | | `0` | Affects eBay's fee base |
| `item_category` | enum `trading_cards` | | `trading_cards` | Only trading cards |
| `seller_plan` | enum `free`\|`starter`\|`pro`\|`shop` | | `free` | Marketplace payout tier |
| `seller_covers_fees` | boolean | | `false` | If false, buyer pays the platform fee |
| `ebay_store_subscription` | boolean | | `false` | Use eBay Store rate (12.35%) vs individual (13.25%) |
| `methods` | array | | eBay + marketplace + storefront | Subset of supported methods |
| `acquisition_cost` | number | | — | Estimates net profit per method |
| `ebay_fee_percent_override` | number | | — | Override estimated eBay FVF % (flat) |

**Supported methods:** `ebay`, `pulltrader_marketplace`, `pulltrader_fbp`, `pulltrader_storefront`, `pulltrader_pos`, and estimated competitor marketplaces `tcgplayer`, `manapool`, `misprint`, `fanatics_collect`, `goldin` (off by default — opt in via `methods`). Competitor figures model **fixed-price / Buy Now seller fees only**; auction formats (hammer price, buyer's premium, negotiated consignment) are not modeled.

**Output (structured):** `currency`, `sale_price`, `methods[]` (each with `gross_amount`, `estimated_total_fees`, `fee_breakdown`, `estimated_payout`, `effective_fee_rate`, `owns_listing`, `fulfilled_by`, `where_it_sells`, `estimated`, `notes`), `difference_from_baseline`, `best_for_seller`, `assumptions`, `inputs_used`, `fee_schedules`, `fee_schedule_version`, `warnings`, `calculated_at`, `disclaimer`, `related_url`. A concise, neutral human summary is returned as text content.

## Example prompts

- "Compare my estimated proceeds on a $250 graded-card sale."
- "What would I keep on an $80 card on eBay vs Pulltrader?"
- "If I'm on the Pro plan, what do I net on a $500 sale through Pulltrader?"
- "Explain the assumptions behind this payout estimate."

## Example response (text summary)

```
On a $250.00 trading-card sale, estimated seller proceeds by method:
- Sell it yourself on eBay: keep $216.47 (estimated) (fees $33.53, 13.41%)
- Pulltrader marketplace (you ship): keep $235.00 (fees $15.00, 6%)
- Your Pulltrader storefront (you ship): keep $250.00 (fees $0.00, 0%)
For these inputs, Your Pulltrader storefront (you ship) returns about $33.53 more than Sell it yourself on eBay.
Estimate based on fee schedules updated 2026-06-01 (Pulltrader) and 2026-06-27 (eBay, estimated). Estimates only, for trading cards in USD. ...
```

> eBay = 13.25% individual FVF + $0.40 per-order fee (orders over $10). The storefront keeps 100% because Pulltrader has **no seller fee** on storefront/POS — only the platform fee, paid by the buyer here. The platform fee is always charged on Pulltrader card sales (buyer pays by default).

## Connecting

### Claude (web / Desktop)
Settings → Connectors → **Add custom connector** → URL `https://mcp.pulltrader.app/mcp`.

### ChatGPT
Settings → Apps & Connectors → Advanced → enable **Developer mode** → **Create** → URL `https://mcp.pulltrader.app/mcp`.

### Cursor / generic
Add to your MCP client config:

```json
{
  "mcpServers": {
    "pulltrader-seller-economics": {
      "url": "https://mcp.pulltrader.app/mcp"
    }
  }
}
```

> **Tested clients:** Claude (web/Desktop), ChatGPT developer mode, Cursor, MCP Inspector. We do not claim universal compatibility with every assistant.

## Public access & rate limits

Public and read-only. A best-effort per-IP rate limit (default 60 req/min) guards the endpoint and returns HTTP 429 with `Retry-After`. There is no authenticated tier in this release.

## Data sources & fee freshness

- **Pulltrader fees** mirror Pulltrader's authoritative internal fee configuration.
- **eBay fees** are an **estimate** of published trading-card rates (tiered individual/Store final value fee + order-size-based per-order fee), updated and reviewed on a schedule. See [docs/FEE_SCHEDULES.md](docs/FEE_SCHEDULES.md). Responses warn if a schedule is past its review date.

## Limitations

- eBay estimates exclude promoted listings, international fees, buyer-paid sales tax, and the seller's own shipping-label cost.
- Not financial advice; actual proceeds vary.
- Trading cards / USD only in this release.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run dev         # wrangler dev (local)
```

Deploy and registry submission require **explicit approval** — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). Do not deploy or publish from a development environment.

## More

- [PRIVACY](docs/PRIVACY.md) · [SECURITY](docs/SECURITY.md) · [TERMS](docs/TERMS.md) · [CHANGELOG](docs/CHANGELOG.md)
- [Fee schedules & update process](docs/FEE_SCHEDULES.md)

## Roadmap

Card market context (comparable sales / pricing) is intentionally **deferred**. It will only be added if this MVP demonstrates useful repeat usage, acceptable cost, reliable outputs, meaningful seller intent, measurable conversion, and low support burden — and after data-licensing and abuse/auth review.

---

Built and maintained by Pulltrader. Support: support@pulltrader.app
