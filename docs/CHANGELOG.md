# Changelog

All notable changes to the Pulltrader Seller Economics MCP server are documented here.
Versioning follows [Semantic Versioning](https://semver.org/). The MCP server version,
`server.json` version, and `package.json` version must stay in sync for registry publishing.

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
