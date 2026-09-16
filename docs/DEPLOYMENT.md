# Deployment

> ⚠️ Deployment is **production-affecting** and requires explicit approval. Do not run `wrangler deploy` from a development session.

## Target
- **Platform:** Cloudflare Workers.
- **Domain:** `mcp.pulltrader.app` (route bound in `wrangler.toml`). The MCP endpoint is `https://mcp.pulltrader.app/mcp`.
- **DNS:** add a proxied record for `mcp.pulltrader.app` on the `pulltrader.app` zone so the Worker route resolves and so the `app.pulltrader/*` registry namespace can be DNS/HTTP-verified.

## Environments
Use a Wrangler environment for staging vs production, e.g.:
- Staging: `mcp-staging.pulltrader.app` (separate route + `name`), conservative rate limit, `beta` flagged in docs.
- Production: `mcp.pulltrader.app`.

## Secrets / vars
- Non-secret vars are in `wrangler.toml` (`PULLTRADER_RELATED_URL`, `DISABLE_ANALYTICS`, `PUBLIC_RATE_LIMIT_PER_MIN`, `DATA_RATE_LIMIT_PER_MIN`, `DATA_RATE_LIMIT_PER_DAY`, `DATA_GLOBAL_LIMIT_PER_DAY`, `PULLTRADER_API_BASE`).
- **KV (required for data tools):** create and bind `MCP_ABUSE` before deploy — data-tool budgets fail closed without it:
  ```bash
  wrangler kv namespace create MCP_ABUSE
  wrangler kv namespace create MCP_ABUSE --preview
  # Paste ids into wrangler.toml [[kv_namespaces]] binding = "MCP_ABUSE"
  ```
- Backend bridge: `wrangler secret put SCOUT_MCP_SECRET` (must match the backend env).
- If enabling analytics: `wrangler secret put POSTHOG_API_KEY` and set `POSTHOG_HOST` (your analytics host).

## Pre-deploy checklist
- [ ] `MCP_ABUSE` KV ids pasted into `wrangler.toml` (not placeholders)
- [ ] `SCOUT_MCP_SECRET` set on the Worker and backend
- [ ] `npm run typecheck` clean
- [ ] `npm test` green
- [ ] `npx wrangler deploy --dry-run` bundles
- [ ] Fee schedules reviewed and not stale
- [ ] Version bumped in `package.json`, `server.json`, `CHANGELOG.md`

## Deploy
```bash
npm run deploy   # wrangler deploy  (APPROVAL REQUIRED)
```

## Post-deploy verification
```bash
curl -s https://mcp.pulltrader.app/health
curl -s https://mcp.pulltrader.app/version
curl -s -X POST https://mcp.pulltrader.app/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Then connect from Claude/ChatGPT/Cursor and run an example prompt.

## Monitoring & ops
- Health: `/health`. Version + fee-schedule versions: `/version`.
- Errors/observability: Cloudflare Workers observability; optional Sentry DSN can be added.
- Cost & rate-limit dashboards: Cloudflare analytics + PostHog (`$source: "mcp"`).

## Rollback
`wrangler rollback` to the previous deployment, or redeploy a prior tagged version. Versioned releases are tracked in `CHANGELOG.md`.
