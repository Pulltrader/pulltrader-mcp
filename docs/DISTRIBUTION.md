# Distribution & registries

> ⚠️ Do **not** submit any listing without explicit approval and credentials. Publish to the **official MCP Registry first** (it is the canonical record other directories crawl), then claim Smithery and others.

## Namespace
`app.pulltrader/seller-economics`, DNS/HTTP-verified against `pulltrader.app` (the reverse-DNS form of `pulltrader.app` is `app.pulltrader`). The remote URL (`https://mcp.pulltrader.app/mcp`) must be on the verified domain. Use this single server record across registries — do not create duplicate servers per registry.

## Prerequisites
- **`mcp.pulltrader.app`** is live (specific zone route on the Worker).
- **Public repo** at `github.com/pulltrader/pulltrader-mcp`; `server.json` references it via the optional `repository` field. A repo is not required for `app.pulltrader` DNS verification.
- **Namespace must match the verified domain.** We do not own a `.com`, so the namespace is `app.pulltrader/*` (verifying `pulltrader.app`), not `com.pulltrader/*`.

## 1. Official MCP Registry (canonical)

| Item | Value |
|---|---|
| Manifest | [`server.json`](../server.json) (schema `2025-12-11`, `remotes[].type = streamable-http`) |
| Hosting | Self-hosted at `mcp.pulltrader.app`; registry stores metadata only |
| Auth to publish | DNS or HTTP domain challenge for the `app.pulltrader` namespace (Ed25519 TXT at the `pulltrader.app` apex) |
| Tooling | `mcp-publisher` CLI |
| Verification | Remote URL must be publicly reachable and on `pulltrader.app` |
| Update | Re-publish a bumped `version` |
| Analytics | None from the registry itself |
| Removal | Re-publish with a deprecated status / delete via CLI |
| Review | No human review queue |

Publish (approval required):
```bash
mcp-publisher login dns           # or: mcp-publisher login http
mcp-publisher validate server.json
mcp-publisher publish
```

## 2. Smithery

| Item | Value |
|---|---|
| Config | [`smithery.yaml`](../smithery.yaml) (remote URL method) |
| Hosting | Bring-your-own; Smithery Gateway proxies to `/mcp` |
| Requirements | Streamable HTTP, public HTTPS (no trailing slash), JSON-RPC errors (never bare 403) |
| Auth | none |
| Analytics | Tool-call analytics provided by Smithery |
| Update | Re-publish the URL |
| Removal | Unpublish via Smithery dashboard/CLI |

Publish (approval required):
```bash
smithery auth login
smithery mcp publish "https://mcp.pulltrader.app/mcp" -n pulltrader/seller-economics
```

> Ensure Cloudflare bot-management does not block Smithery's scan IPs.

## 3. Other directories
PulseMCP, Glama, and similar largely **crawl the official registry** — once the canonical record is correct, claim those listings rather than re-authoring metadata. Verify each is active and provides real discovery before investing effort.

## Listing copy

**Title:** Pulltrader Seller Economics

**Short description (≤ ~120 chars):**
> Compare what a trading-card seller keeps across eBay and Pulltrader selling methods.

**Long description:**
> A public, read-only MCP server for trading-card sellers. Ask what you'd net on a sale and get a deterministic, side-by-side comparison of estimated fees and seller proceeds across eBay and Pulltrader's selling methods (marketplace, Fulfilled by Pulltrader, branded storefront, in-person POS). Every estimate states its assumptions, fee-schedule date, and limitations — eBay figures are clearly labeled estimates, and the tool never claims one platform is always cheapest. No account required.

**Categories:** finance, ecommerce, productivity
**Tags:** trading-cards, seller-tools, fees, ebay, payout, pulltrader

**Example prompts:**
- "Compare my estimated proceeds on a $250 graded-card sale."
- "What would I keep on an $80 card on eBay vs Pulltrader?"
- "If I'm on the Pro plan, what do I net on a $500 sale through Pulltrader?"
- "Explain the assumptions behind this payout estimate."

**Privacy policy:** [docs/PRIVACY.md](PRIVACY.md) · **Terms:** [docs/TERMS.md](TERMS.md)
**Support:** support@pulltrader.app · **Docs/Repo:** https://pulltrader.app/mcp

## Pre-publish checklist
- [ ] Production endpoint live and verified (`/health`, `/version`, `tools/list`)
- [ ] `mcp.pulltrader.app` DNS-verified for the namespace
- [ ] `server.json` / `package.json` versions in sync
- [ ] Privacy + Terms URLs reachable
- [ ] Tested in Claude + ChatGPT + Cursor
- [ ] Explicit approval to submit
