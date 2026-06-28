# Security

## Posture
- **Read-only.** No write actions of any kind: no listing creation, repricing, purchasing, payouts, inventory, or account changes.
- **No authentication / no private data.** The server only does deterministic math over public fee schedules. It connects to no Pulltrader database or private API.
- **Allowlist inputs.** Every field is explicitly validated against an enum/range; unknown fields are rejected (`additionalProperties: false`). No free-form query is accepted.

## Threat model & mitigations

| Threat | Mitigation |
|---|---|
| Prompt injection via tool inputs | Inputs are strictly typed/validated and only feed arithmetic; no input is executed or used to build downstream requests. |
| Malicious text in external data | No external/3rd-party data is fetched at request time. |
| Excessive queries / DoS | Best-effort per-IP rate limit (HTTP 429 + `Retry-After`); no expensive work per call. |
| Scraping / data extraction | No proprietary data is exposed; only fee math. |
| Competitor fee abuse | eBay schedule is a small static estimate; nothing to harvest. |
| Enumeration | No identifiers or datasets are queryable. |
| Auth bypass / token leakage | No auth and no secrets on the request path. |
| Logging sensitive data | Only non-PII operational events logged (see PRIVACY). |
| SSRF | The server makes no request-time outbound calls except the optional fire-and-forget analytics beacon to a fixed, configured host. |
| Dependency vulnerabilities | Zero runtime dependencies; only build/dev deps (`wrangler`, `typescript`, `vitest`). Run `npm audit` in CI. |
| Cross-tenant / private inventory access | Not applicable — no tenant data exists in this server. |
| Registry / namespace spoofing | Published under DNS-verified `app.pulltrader/*` bound to `pulltrader.app`; remote URL must be on the verified domain. |

## Hardening notes
- The in-memory rate limiter is per-isolate (best effort). For a strict global limit, migrate to a Durable Object or KV counter.
- The endpoint returns JSON-RPC errors and proper HTTP statuses; it never returns a bare 403 to unauthenticated callers (so registry/Smithery scans succeed).
- No stack traces are returned to clients; internal failures map to `INTERNAL_ERROR`.

## Reporting
Report vulnerabilities to security@pulltrader.app.
