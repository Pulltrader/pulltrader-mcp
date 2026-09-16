# Changelog

All notable changes to the Pulltrader Seller Economics MCP server are documented here.
Versioning follows [Semantic Versioning](https://semver.org/). The MCP server version,
`server.json` version, and `package.json` version must stay in sync for registry publishing.

## [0.5.0]
### Added
- **Abuse / token-bill protection:** KV-backed global budgets on data tools (`identify_card`, `search_card_sales`, `summarize_card_market`, `get_card_price_history`) — default 8/min/IP, 40/day/IP, 10k/day global. Fail closed if `MCP_ABUSE` KV is unavailable. Coarse 60/min/IP request limit remains (fail open). Batch size capped at 5. Worker forwards `X-Scout-Client-IP` to the backend bridge for per-caller rate limiting.
- Card-market payloads (`search_card_sales`, `summarize_card_market`) now surface the authoritative vendor price when eBay has no dated comps: `market_value`, `value_source` (`"TCG Market"` | `"CardSightAI"` | `"eBay Comps"`), `price_change_7d`, `price_change_30d`, and a single `image` (catalog reference media — TCGplayer/Scryfall/CardSight). Previously TCG/Pokemon/Magic cards returned "not enough sales" even when JustTCG/CardSightAI had a value and image. Per-listing scraped/affiliate URLs and images remain stripped; only the catalog reference image is exposed (consistent with athlete headshots).

## [0.4.0]
### Added
- Four read-only **data-backed** card tools that bridge to the Pulltrader backend (`/api/mcp/*`, secret-protected server-to-server) and apply the "limited public" shaping decision:
  - `identify_card` — resolve a free-text description into structured fields (player, year, set, number, parallel, grader, grade, category) with a confidence level.
  - `search_card_sales` — a capped sample of recent comparable sold sales (price + date, no outbound listing/affiliate URLs) plus a market snapshot.
  - `summarize_card_market` — canonical market value (median, mean, p10–p90, volatility, confidence) computed with `@pulltrader/scout-domain` over the backend's sold-comp sample.
  - `get_card_price_history` — a chart-ready day/week/month series with a trend, aggregated by `@pulltrader/scout-domain` (single source of truth for bucketing).
- Backend client (`src/backend/client.ts`): typed, injectable-`fetch`, timeout-bounded calls to the bridge; all failures map to stable tool errors (`DATA_BACKEND_UNAVAILABLE`, `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT`, `NOT_FOUND`, `RATE_LIMITED`).
- New env: `PULLTRADER_API_BASE` (var) + `SCOUT_MCP_SECRET` (wrangler secret). The card tools are enabled only when **both** are set; otherwise they degrade gracefully to `DATA_BACKEND_UNAVAILABLE` (the seller-economics tools are unaffected).

### Changed
- The JSON-RPC dispatch path (`handleMcpMessage`, `tool.run`) is now **async** to support the data-backed tools; the pure seller-economics tools are unchanged in behavior (still synchronous internally) and all existing outputs/defaults are identical.
- Server identity on `initialize` is now "Scout by Pulltrader" (was "… — Seller Economics") and the `instructions` describe the full card-research + seller-economics tool set. Registry `name` (`app.pulltrader/seller-economics`) and `serverInfo.name` (`pulltrader-mcp`) are unchanged.
- `server.json` advertises all seven tools and updated tags/description; still `authentication: none`, `readOnly: true`.

### Notes
- No breaking changes to the seller-economics tools. The card tools are estimate-only, limited-public (capped sample, no affiliate/image URLs), and never present guaranteed value or financial advice. Athlete tools (`get_athlete_profile`) and the public `app.pulltrader/scout` registry alias are intentionally deferred to later stages.

## [0.3.0]
### Added
- Two new read-only tools, both backed by the shared `@pulltrader/scout-domain` fee engine:
  - `calculate_required_sale_price` — inverse of `compare_selling_costs`: given a target take-home (or net profit, when `acquisition_cost` is supplied), solves for the per-item sale price needed on a single selling method via deterministic search over the same engine. Honors Binz fixed pricing and per-order fees.
  - `explain_selling_method` — plain, structured explanation of how each supported method (eBay, Pulltrader marketplace/FBP/storefront/POS, and estimated competitor marketplaces) owns the listing, fulfills, and charges fees. Derived from the engine + schedules so it never drifts from `compare_selling_costs`.
- Tool registry (`src/tools/registry.ts`) so the JSON-RPC layer dispatches over a list of tools.

### Changed
- The fee schedules and fee/payout engine are now sourced from the shared `@pulltrader/scout-domain` package (single source of truth across the MCP server, the Pulltrader backend, and the Scout Discord bot). `src/fees/schedule.ts` and `src/fees/calculator.ts` are now thin re-export shims; all fee values and `compare_selling_costs` outputs are unchanged (locked by the existing unit + contract tests, which now exercise the shared package).
- Server identity surfaced on `initialize` is now "Scout by Pulltrader — Seller Economics" to reflect the unified Scout product direction. The registry `name` (`app.pulltrader/seller-economics`) and the worker `serverInfo.name` (`pulltrader-mcp`) are unchanged.

### Notes
- No breaking changes: `compare_selling_costs` inputs/outputs and all defaults are identical. The two additions are optional new tools (minor release).
- Card identification, comparable-sales, market-summary, and price-history tools are intentionally NOT added here — they require live data and will land with the Worker→backend bridge in a later stage.

## [0.2.2]
### Changed
- Added a `repository` link (`github.com/pulltrader/pulltrader-mcp`) to `server.json` and `package.json`, and generalized internal references in source comments and docs ahead of the public repo. No tool behavior or fee values changed.

## [0.2.1]
### Changed
- Clarified the Goldin schedule's conditional notes: the fixed-price Marketplace requires graded items in the Goldin/Collectors Vault ($100+), the 22% buyer's premium applies to Marketplace purchases (not only auctions), and the auction format (seller keeps ~100% of hammer, negotiated consignment) is separate. Fee values are unchanged.

## [0.2.0]
### Added
- Estimated competitor marketplaces in `compare_selling_costs` (off by default; opt in via `methods`): `tcgplayer`, `manapool`, `misprint`, `fanatics_collect`, `goldin`.
- Generic competitor fee model in `src/fees/schedule.ts` (`COMPETITOR_FEES`) and `computeCompetitor` in the calculator: flat or price-tiered commission, optional per-item cap, and optional separate payment processing.
- Only fixed-price / Buy Now seller fees are modeled; auction formats (hammer price, buyer's premium, negotiated consignment) are explicitly out of scope and documented per platform.
- `competitor_fee_schedules` provenance array in the tool output, per-competitor staleness warnings, and a competitor-specific assumption line.
- Each competitor schedule carries its own source URL, effective/review dates, and conditional notes.

### Notes
- No breaking changes; defaults (eBay + Pulltrader marketplace + storefront) and all existing outputs are unchanged.

## [0.1.0] — Unreleased (internal)
### Added
- Initial MVP: single tool `compare_selling_costs`.
- Deterministic seller-economics engine mirroring Pulltrader's authoritative fee configuration (marketplace tiers, Binz pricing, storefront/POS, FBP).
- Versioned, dated fee schedules with a staleness warning (Pulltrader authoritative; eBay estimated).
- Streamable HTTP transport at `/mcp`; `/health` and `/version` endpoints.
- Machine-readable error codes, structured + human-readable responses, privacy-safe analytics hook, best-effort rate limiting.
- Registry assets (`server.json`), Smithery listing (`smithery.yaml`), docs, and a full test suite (unit, boundary, contract).

### Versioning & deprecation policy
- **Patch:** bug fixes, copy, non-breaking fee-schedule value updates (bump schedule `version` + dates).
- **Minor:** new optional inputs/outputs or new tools (backwards compatible).
- **Major:** breaking changes to tool names, required inputs, or output shape.
- Breaking changes are announced here at least one minor release ahead where practical. Removed tools return a clear `UNSUPPORTED_*` error for one minor cycle before deletion.
