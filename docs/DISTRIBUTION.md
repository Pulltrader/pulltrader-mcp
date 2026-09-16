# Distribution & registries

> ⚠️ Do **not** submit any listing without explicit approval and credentials. Publish to the **official MCP Registry first** (it is the canonical record other directories crawl), then claim Smithery and others.

## 0. Public mirror (do this first, every release)

Directories judge a server by its repo: last-commit date, tag history, and the tool list in `server.json`. The public mirror at `github.com/pulltrader/pulltrader-mcp` is what they read, and it is **generated, never hand-edited**:

```bash
scripts/sync-mcp-public.sh ~/pulltrader-mcp --dry-run   # review
scripts/sync-mcp-public.sh ~/pulltrader-mcp
cd ~/pulltrader-mcp && npm ci && npm run typecheck && npm test
git add -A && git commit -m "Release <version>" && git tag v<version>
git push && git push --tags
```

The script vendors `packages/scout-domain` into `vendor/scout-domain` and rewrites the path alias, so the mirror builds with no monorepo on disk. It excludes `worker-secrets.manifest` and `docs/MEASUREMENT.md`, and redacts the `MCP_ABUSE` KV ids from `wrangler.toml`.

> A release that ships to production but not to the mirror is what makes the server look abandoned. Mirror sync, registry re-publish, and the `/mcp` marketing page all belong to the same release checklist.

## Namespace

`app.pulltrader/seller-economics`, DNS/HTTP-verified against `pulltrader.app` (the reverse-DNS form of `pulltrader.app` is `app.pulltrader`). The remote URL (`https://mcp.pulltrader.app/mcp`) must be on the verified domain. Use this single server record across registries — do not create duplicate servers per registry.

## Prerequisites

* **`mcp.pulltrader.app`** is live (specific zone route on the Worker).
* **Public repo** at `github.com/pulltrader/pulltrader-mcp`; `server.json` references it via the optional `repository` field. A repo is not required for `app.pulltrader` DNS verification.
* **Namespace must match the verified domain.** We do not own a `.com`, so the namespace is `app.pulltrader/*` (verifying `pulltrader.app`), not `com.pulltrader/*`.

## 1. Official MCP Registry (canonical)

| Item            | Value                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest        | [`server.json`](https://github.com/pulltrader/pulltrader-mcp/blob/main/server.json) (schema `2025-12-11`, `remotes[].type = streamable-http`) |
| Hosting         | Self-hosted at `mcp.pulltrader.app`; registry stores metadata only                                                                                                                |
| Auth to publish | DNS or HTTP domain challenge for the `app.pulltrader` namespace (Ed25519 TXT at the `pulltrader.app` apex)                                                                        |
| Tooling         | `mcp-publisher` CLI                                                                                                                                                               |
| Verification    | Remote URL must be publicly reachable and on `pulltrader.app`                                                                                                                     |
| Update          | Re-publish a bumped `version`                                                                                                                                                     |
| Analytics       | None from the registry itself                                                                                                                                                     |
| Removal         | Re-publish with a deprecated status / delete via CLI                                                                                                                              |
| Review          | No human review queue                                                                                                                                                             |

Publish (approval required):

```bash
mcp-publisher login dns           # or: mcp-publisher login http
mcp-publisher validate server.json
mcp-publisher publish
```

## 2. Smithery

| Item         | Value                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Config       | [`smithery.yaml`](https://github.com/pulltrader/pulltrader-mcp/blob/main/smithery.yaml) (remote URL method) |
| Hosting      | Bring-your-own; Smithery Gateway proxies to `/mcp`                                                                                              |
| Requirements | Streamable HTTP, public HTTPS (no trailing slash), JSON-RPC errors (never bare 403)                                                             |
| Auth         | none                                                                                                                                            |
| Analytics    | Tool-call analytics provided by Smithery                                                                                                        |
| Update       | Re-publish the URL                                                                                                                              |
| Removal      | Unpublish via Smithery dashboard/CLI                                                                                                            |

Publish (approval required):

```bash
smithery auth login
smithery mcp publish "https://mcp.pulltrader.app/mcp" -n pulltrader/seller-economics
```

> Ensure Cloudflare bot-management does not block Smithery's scan IPs.

## 3. Glama

| Item     | Value                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| Config   | [`glama.json`](https://github.com/pulltrader/pulltrader-mcp/blob/main/glama.json) in the mirror repo root |
| Ingest   | Crawls the public repo + the official registry record                        |
| Claiming | `maintainers` must list the GitHub account that claims the listing            |
| Freshness | Scored from repo activity — a stale mirror reads as unmaintained even when production is current |

## 4. Other directories

PulseMCP, MCP.so, and similar largely **crawl the official registry and the public repo** — once the canonical record and the mirror are correct, claim those listings rather than re-authoring metadata. Verify each is active and provides real discovery before investing effort.

## Listing copy

**Title:** Scout by Pulltrader

**Short description (≤ \~120 chars):**

> Identify cards, look up sold comps, and compare what a seller keeps across eBay and Pulltrader.

**Long description:**

> A public, read-only MCP server for trading-card research and selling. Identify a card from a text description, pull recent comparable sold sales, get a summarized market value with volatility and confidence, and chart price history — then compare what a seller would net on eBay vs Pulltrader's selling methods (marketplace, Fulfilled by Pulltrader, branded storefront, in-person POS). Every estimate states its assumptions, data freshness, and limitations — eBay figures are clearly labeled estimates, card-market data is limited-public, and the tool never claims one platform is always cheapest or gives financial advice. No account required.

**Categories:** finance, ecommerce, productivity **Tags:** trading-cards, comps, market-value, price-history, card-identification, seller-tools, fees, ebay, payout, pulltrader

**Example prompts:**

* "What is this card: 2023 Bowman Chrome Elly De La Cruz PSA 10?"
* "Show me recent sold comps and market value for that card."
* "Compare my estimated proceeds on a $250 graded-card sale."
* "What would I keep on an $80 card on eBay vs Pulltrader?"
* "If I'm on the Pro plan, what do I net on a $500 sale through Pulltrader?"

**Privacy policy:** [docs/PRIVACY.md](PRIVACY.md) · **Terms:** [docs/TERMS.md](TERMS.md) **Support:** support@pulltrader.app · **Docs/Repo:** https://pulltrader.app/mcp

## Pre-publish checklist

* [ ] Public mirror synced, green, committed and tagged `v<version>` (section 0)
* [ ] `server.json` `tools` array matches `src/tools/registry.ts` exactly
* [ ] Production endpoint live and verified (`/health`, `/version`, `tools/list`)
* [ ] `mcp.pulltrader.app` DNS-verified for the namespace
* [ ] `server.json` / `package.json` versions in sync
* [ ] Privacy + Terms URLs reachable
* [ ] Tested in Claude + ChatGPT + Cursor
* [ ] `pulltrader-marketing/lib/mcpContent.ts` `SERVER_VERSION` matches
* [ ] Explicit approval to submit
