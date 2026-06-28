# Privacy

The Pulltrader Seller Economics MCP server is designed to collect as little as possible.

## What is processed
- Tool inputs (e.g. `sale_price`, `seller_plan`) are used **only** to compute the response and are **not persisted**.
- The server performs no card identification and stores no card queries.

## What is logged
When privacy-safe analytics are enabled, we capture only **operational** signals:
- Tool name (`compare_selling_costs`)
- Success / error state and error code
- Latency (ms)
- A coarse, **non-reversible** anonymous request fingerprint (truncated SHA-256 of connection metadata)

We do **not** log or store:
- IP addresses
- Card queries or prices in natural language
- Full request/response bodies or conversations
- Access tokens or credentials (this server has none)

Analytics can be disabled entirely via the `DISABLE_ANALYTICS=1` variable and are a no-op unless a PostHog key is configured. Events use `$source: "mcp"`.

## Retention & processors
- No raw request data is retained.
- Aggregate operational events (if enabled) are sent to PostHog (via a configured analytics host) as the analytics processor.

## Model training
Inputs are not used to train models.

## Deletion
Because no personal data or query content is retained, there is nothing to delete per request. Questions: privacy@pulltrader.app.
