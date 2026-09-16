# Security

## Posture
- **Read-only.** No write actions of any kind: no listing creation, repricing, purchasing, payouts, inventory, or account changes.
- **No end-user authentication.** The public MCP endpoint is anonymous. Fee tools run locally; card/data tools call a secret-protected Pulltrader backend bridge (`X-Scout-MCP-Secret`). No Pulltrader account credentials are accepted on the public path.
- **Allowlist inputs.** Tool arguments are explicitly validated against an enum/range; unknown fields are rejected (`additionalProperties: false`).

## Threat model & mitigations

| Threat | Mitigation |
|---|---|
| Prompt injection via tool inputs | Fee tools: typed inputs feed arithmetic only. Data tools: free-text queries are forwarded to the backend as strings for identification/comps — never executed. |
| Anthropic / comps cost abuse | KV-backed global budgets on data tools (`identify_card`, `search_card_sales`, `summarize_card_market`, `get_card_price_history`): 8/min/IP, 40/day/IP, 10k/day global (env-tunable). Fail **closed** if KV is unavailable. |
| Excessive queries / DoS | Coarse per-IP request limit (default 60/min, KV + in-memory L1). Fail **open** if KV is down so fee math keeps working. HTTP 429 + `Retry-After`. Batch size capped at 5. |
| Bridge abuse with leaked secret | Backend `/api/mcp/*` requires shared secret; keys rate limits by Worker-forwarded `X-Scout-Client-IP` (trusted only after secret check); tighter 15/min cap on identify/card-market. |
| Scraping / data extraction | Card tools return a limited-public tier (capped comps, no scraped listing URLs). Fee tools expose only fee math. |
| Auth bypass / token leakage | No end-user auth on the public path. Backend bridge secret is a wrangler secret, never returned to clients. |
| Logging sensitive data | Only non-PII operational events logged (see PRIVACY). Card queries and prices are not logged by the Worker. |
| SSRF | Outbound calls are limited to the configured analytics host and the configured Pulltrader API base. |
| Dependency vulnerabilities | Zero runtime dependencies; only build/dev deps (`wrangler`, `typescript`, `vitest`). Run `npm audit` in CI. |
| Cross-tenant / private inventory access | Not applicable — public tools cannot read or write account/inventory data. |
| Registry / namespace spoofing | Published under DNS-verified `app.pulltrader/*` bound to `pulltrader.app`; remote URL must be on the verified domain. |

## Abuse budgets (defaults)

| Bucket | Scope | Default | Applies to |
|--------|-------|---------|------------|
| Request | per IP / minute | 60 | All `POST /mcp` |
| Data | per IP / minute | 8 | Four data tools |
| Data | per IP / day | 40 | Four data tools |
| Data | global / day | 10_000 | Four data tools (circuit breaker) |

Configured via `PUBLIC_RATE_LIMIT_PER_MIN`, `DATA_RATE_LIMIT_PER_MIN`, `DATA_RATE_LIMIT_PER_DAY`, `DATA_GLOBAL_LIMIT_PER_DAY` and the `MCP_ABUSE` KV binding. See `src/abuseGuard.ts`.

## Hardening notes
- KV counters are eventually consistent; slight overshoot under concurrency is acceptable for abuse guards.
- Data-tool denials return a tool-level `isError` with `RATE_LIMITED` (not always HTTP 429) so MCP clients can surface a retryable tool error.
- The endpoint never returns a bare 403 to unauthenticated callers (so registry/Smithery scans succeed).
- No stack traces are returned to clients; internal failures map to `INTERNAL_ERROR`.

## Reporting
Report vulnerabilities to security@pulltrader.app.
