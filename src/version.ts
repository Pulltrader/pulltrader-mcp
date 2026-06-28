// Server identity. `REGISTRY_NAME` must match the `name` in server.json and the
// `mcpName` used for any published package, per the official MCP Registry rules.
export const SERVER_NAME = "pulltrader-mcp";
export const REGISTRY_NAME = "app.pulltrader/seller-economics";
export const SERVER_VERSION = "0.2.1";

// MCP protocol revision we implement against. We echo the client's requested
// protocolVersion on initialize when present, falling back to this.
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
