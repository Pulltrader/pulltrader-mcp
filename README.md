# Scout by Pulltrader — Trading-Card MCP Server

> Identify a card, pull recent sold comps, summarize its market value, chart its price history, and compare what a seller keeps across eBay, Pulltrader, and other card marketplaces — inside your AI assistant.

A public, read-only [Model Context Protocol](https://modelcontextprotocol.io) server for **trading-card research and selling**. Seven tools: four back onto Scout's card data (identification, comparable sold sales, market value, price history), three run Pulltrader's deterministic seller-economics engine over a dated, versioned fee schedule.

Market figures are **estimates** derived from recent sales. Fee math is **deterministic** — the server computes it and never asks the model to infer fees from prose. eBay figures are clearly labeled estimates.

- **Transport:** Streamable HTTP (`POST /mcp`)
- **Auth:** none (public, read-only)
- **Endpoint:** `https://mcp.pulltrader.app/mcp`
- **Registry name:** `app.pulltrader/seller-economics`
- **Protocol:** `2025-06-18` (the client's requested version is echoed when present)

## Who it's for

Trading-card sellers, dealers, shops, and collectors who want to know what a card is, what it's worth, and what they'd actually take home selling it — without leaving their assistant.

## What it does (and doesn't)

| Does | Doesn't |
|---|---|
| Resolve a prose card description into structured fields | Identify a card from an **image** (text only) |
| Return recent comparable **sold** sales (price + date) | Return listing, affiliate, or per-sale outbound URLs |
| Summarize market value: median, mean, p10–p90, volatility, confidence | Claim a guaranteed value or give financial advice |
| Chart price history by day / week / month with a trend | Make any write, order, or account change |
| Estimate seller fees and net proceeds per selling method | Claim one platform is universally cheapest |
| Solve for the price needed to hit a target net | Model auction formats (hammer, buyer's premium, consignment) |
| State its assumptions, data freshness, and limitations | Cover non-card categories or currencies other than USD |

## Tools

### Card research (data-backed)

These bridge to the Pulltrader backend. Card data is **limited-public**: a capped sample of sales, no per-listing or affiliate URLs, and only the catalog reference image.

Each accepts either `query` (a natural-language description, e.g. `"2023 Panini Prizm Victor Wembanyama #136 Silver PSA 10"`) or `item` (structured fields: `player_athlete`, `year_manufactured`, `set_name`, `card_number`, `parallel_variety`, `grader`, `grade`, `sport`). One of the two is required.

| Tool | What it returns |
|---|---|
| `identify_card` | Canonical fields (player/athlete, year, set, number, parallel, grader, grade, category) plus a confidence level and which fields resolved. Takes `query` only. Does not price the card. |
| `search_card_sales` | A capped sample of recent comparable sold sales (price + date) plus a market snapshot. Optional `limit`. |
| `summarize_card_market` | Canonical market value: median, mean, p10–p90, volatility, sample size, confidence. |
| `get_card_price_history` | A chart-ready time series with a trend. Optional `interval`: `day` \| `week` \| `month`. |

When eBay has no dated comps, `search_card_sales` and `summarize_card_market` fall back to the authoritative vendor price and surface `market_value`, `value_source` (`TCG Market` \| `CardSightAI` \| `eBay Comps`), `price_change_7d`, `price_change_30d`, and a single catalog `image`.

### Seller economics (deterministic, no I/O)

| Tool | What it returns |
|---|---|
| `compare_selling_costs` | Estimated fees and net proceeds for one sale across selling methods, with a per-method fee breakdown, the difference vs the eBay baseline, and the assumptions used. Requires `sale_price`. |
| `calculate_required_sale_price` | The per-item price needed to reach a target take-home (or net profit, when `acquisition_cost` is given) on a single method. Requires `target_net`. |
| `explain_selling_method` | Plain, structured explanation of how each method owns the listing, fulfills, and charges fees. Derived from the same engine, so it never drifts from `compare_selling_costs`. |

**Shared inputs** (`compare_selling_costs`, `calculate_required_sale_price`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `currency` | enum `USD` | `USD` | Only USD supported |
| `quantity` | integer | `1` | Per-order fixed fees applied once |
| `shipping_amount` | number | `0` | Affects eBay's fee base |
| `item_category` | enum `trading_cards` | `trading_cards` | Only trading cards |
| `seller_plan` | `free`\|`starter`\|`pro`\|`shop` | `free` | Marketplace payout tier |
| `seller_level` | enum | derived from plan | Explicit payout level override |
| `seller_covers_fees` | boolean | `false` | If false, the buyer pays the platform fee |
| `ebay_store_subscription` | boolean | `false` | eBay Store rate (12.35%) vs individual (13.25%) |
| `acquisition_cost` | number | — | Switches output to net profit |
| `ebay_fee_percent_override` | number | — | Override the estimated eBay FVF % (flat) |

**Supported methods:** `ebay`, `pulltrader_marketplace`, `pulltrader_fbp`, `pulltrader_storefront`, `pulltrader_pos`, plus estimated competitor marketplaces `tcgplayer`, `manapool`, `misprint`, `fanatics_collect`, `goldin` (off by default — opt in via `methods`). Competitor figures model **fixed-price / Buy Now seller fees only**.

## Example prompts

- "What is this card: 2023 Bowman Chrome Elly De La Cruz PSA 10?"
- "Show me recent sold comps and the market value for that card."
- "What's the price history on a 2018 Prizm Luka Doncic Silver PSA 10 over the last year?"
- "Compare my estimated proceeds on a $250 graded-card sale."
- "What would I keep on an $80 card on eBay vs Pulltrader?"
- "What do I have to sell it for to clear $200 after fees?"
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
    "scout-by-pulltrader": {
      "url": "https://mcp.pulltrader.app/mcp"
    }
  }
}
```

> **Tested clients:** Claude (web/Desktop), ChatGPT developer mode, Cursor, MCP Inspector. We do not claim universal compatibility with every assistant.

## Public access & rate limits

Public and read-only. There is no authenticated tier in this release.

| Limit | Default | Notes |
|---|---|---|
| All `POST /mcp` | 60 / IP / min | HTTP 429 + `Retry-After`. Fail-open if KV is down. |
| Data tools (identify / comps / market / history) | 8 / IP / min, 40 / IP / day | Tool `isError` `RATE_LIMITED`. Fail-closed if KV is down. |
| Data tools global | 10,000 / day | Circuit breaker for model + comps spend. |
| Batch size | 5 messages | Larger batches are rejected. |

Requires the `MCP_ABUSE` KV namespace (see `wrangler.toml`). Tune via `PUBLIC_RATE_LIMIT_PER_MIN`, `DATA_RATE_LIMIT_PER_MIN`, `DATA_RATE_LIMIT_PER_DAY`, `DATA_GLOBAL_LIMIT_PER_DAY`.

## Errors

Input problems come back as a tool result with `isError: true` and a stable code, not a JSON-RPC error: `INVALID_INPUT`, `NOT_FOUND`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT`, `DATA_BACKEND_UNAVAILABLE`, `INTERNAL_ERROR`. Unknown methods and malformed envelopes use standard JSON-RPC error codes.

The four card tools require the backend bridge (`PULLTRADER_API_BASE` + `SCOUT_MCP_SECRET`). Without it they degrade to `DATA_BACKEND_UNAVAILABLE`; the three seller-economics tools are pure and always available.

## Data sources & fee freshness

- **Card data** is limited-public and estimate-only: a capped sample of recent sold comps, aggregated by the shared Scout domain engine.
- **Pulltrader fees** mirror Pulltrader's authoritative internal fee configuration.
- **eBay fees** are an **estimate** of published trading-card rates (tiered individual/Store final value fee + order-size-based per-order fee), updated and reviewed on a schedule. See [docs/FEE_SCHEDULES.md](docs/FEE_SCHEDULES.md). Responses warn if a schedule is past its review date.

Current schedule versions are served live at [`/version`](https://mcp.pulltrader.app/version).

## Limitations

- eBay estimates exclude promoted listings, international fees, buyer-paid sales tax, and the seller's own shipping-label cost.
- Market values are estimates from recent sales, excluding fees, taxes, and shipping.
- Not financial advice; actual proceeds and actual value vary.
- Trading cards / USD only in this release.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run dev         # wrangler dev (local)
```

Deploy and registry submission require **explicit approval** — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). Do not deploy or publish from a development session.

## More

- [PRIVACY](docs/PRIVACY.md) · [SECURITY](docs/SECURITY.md) · [TERMS](docs/TERMS.md) · [CHANGELOG](docs/CHANGELOG.md)
- [Fee schedules & update process](docs/FEE_SCHEDULES.md)

## Deploy prerequisites

```bash
wrangler kv namespace create MCP_ABUSE
wrangler kv namespace create MCP_ABUSE --preview
# Paste ids into wrangler.toml [[kv_namespaces]] binding MCP_ABUSE
wrangler secret put SCOUT_MCP_SECRET
```

## Roadmap

- Image-based card identification.
- Athlete/player profile tools.
- Authenticated per-user quotas (OAuth), deferred until measurement shows a need.

---

Built and maintained by Pulltrader. Support: support@pulltrader.app

<sub>This repository is the public mirror of the Scout MCP Worker, exported from the Pulltrader monorepo on each release. Issues and questions are welcome here; pull requests are applied upstream. `wrangler.toml` KV ids are redacted — deploys run from the monorepo.</sub>
