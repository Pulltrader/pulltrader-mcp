// =============================================================================
// SCOUT BACKEND CLIENT
// =============================================================================
// Thin, typed client the data-backed tools use to call the Pulltrader backend's
// secret-protected /api/mcp/* bridge (pulltrader-backend/routes/scoutMcp.js).
//
// Server-to-server: sends the X-Scout-MCP-Secret header. `fetchImpl` is injected
// so tools stay unit-testable without network. All failures are mapped to a
// typed BackendResult (never throws) so tool handlers can translate them into
// MCP tool errors.
// =============================================================================

export interface BackendConfig {
  baseUrl: string;
  secret: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Default 12s (cards) — backend calls upstream providers. */
  timeoutMs?: number;
  /**
   * End-user IP (from CF-Connecting-IP). Forwarded as X-Scout-Client-IP so the
   * backend bridge can rate-limit by caller, not by the Worker origin.
   */
  clientIp?: string;
}

export type BackendErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED";

export type BackendResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: BackendErrorCode; status?: number; message: string };

// ---- Payload types (mirror pulltrader-backend/services/scoutMcpService.js) ----

export interface CardIdentity {
  player_athlete: string | null;
  year: string | null;
  set_name: string | null;
  card_number: string | null;
  parallel: string | null;
  grader: string | null;
  grade: string | null;
  sport: string | null;
}

export interface IdentifyPayload {
  query: string | null;
  category: string | null;
  identity: CardIdentity;
  fields_extracted: number;
  confidence: "high" | "medium" | "low";
}

export interface DatedSale {
  price: number;
  soldDate: string | null;
}
export interface ExampleSale {
  title: string;
  price: number;
  sold_date: string | null;
}

export interface CardMarketPayload {
  query: string | null;
  category: string | null;
  ebay_search_url: string | null;
  sample_count: number;
  has_partial_matches: boolean;
  /** True when the queried card is graded — eBay sold comps drive the headline. */
  is_graded: boolean;
  /**
   * Headline value from the authoritative provider, chosen by grade:
   * raw cards -> JustTCG/CardSightAI; graded cards -> eBay sold comps.
   */
  market_value: number | null;
  /** Provider that produced market_value: "TCG Market" | "CardSightAI" | "eBay Comps". */
  value_source: string | null;
  /** Catalog card image (reference media), when available. */
  image: string | null;
  price_change_7d: number | null;
  price_change_30d: number | null;
  dated_sales: DatedSale[];
  example_sales: ExampleSale[];
  reference_stats: {
    sample_count: number | null;
    median: number | null;
    mean: number | null;
    low: number | null;
    high: number | null;
    std_dev: number | null;
    last_sold_date: string | null;
  };
  tcg_price_history: {
    price_history_7d: unknown;
    price_history_30d: unknown;
    price_change_7d: number | null;
    price_change_30d: number | null;
    avg_price_7d: number | null;
    avg_price_30d: number | null;
  } | null;
  data_freshness: { last_sold_date: string | null; retrieved_at: string };
  disclaimer: string;
}

export interface AthletePayload {
  player: Record<string, unknown>;
  stats: Record<string, unknown>;
  outlook: { label: string | null; score: number | null; confidence: string | null };
  platform_stats: unknown;
  marketplace_listings: unknown[];
  data_freshness: { analysis_generated_at: string | null; retrieved_at: string };
  disclaimer: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;

function isConfigured(cfg: BackendConfig | undefined): cfg is BackendConfig {
  return !!cfg && typeof cfg.baseUrl === "string" && cfg.baseUrl.length > 0 && typeof cfg.secret === "string" && cfg.secret.length > 0;
}

async function request<T>(
  cfg: BackendConfig | undefined,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<BackendResult<T>> {
  if (!isConfigured(cfg)) {
    return { ok: false, code: "NOT_CONFIGURED", message: "The Scout data backend is not configured for this server." };
  }

  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "x-scout-mcp-secret": cfg.secret,
    };
    if (cfg.clientIp && cfg.clientIp !== "unknown") {
      headers["x-scout-client-ip"] = cfg.clientIp;
    }

    const res = await doFetch(url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });

    if (res.status === 404) {
      return { ok: false, code: "NOT_FOUND", status: 404, message: "Not found." };
    }
    if (res.status === 429) {
      return { ok: false, code: "RATE_LIMITED", status: 429, message: "The data backend is rate limiting requests." };
    }
    if (!res.ok) {
      return { ok: false, code: "UPSTREAM_ERROR", status: res.status, message: `Data backend returned HTTP ${res.status}.` };
    }

    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return aborted
      ? { ok: false, code: "TIMEOUT", message: "The data backend did not respond in time." }
      : { ok: false, code: "UPSTREAM_ERROR", message: "Failed to reach the data backend." };
  } finally {
    clearTimeout(timeout);
  }
}

export function identifyCardRequest(cfg: BackendConfig | undefined, query: string): Promise<BackendResult<IdentifyPayload>> {
  return request<IdentifyPayload>(cfg, "POST", "/api/mcp/identify-card", { query });
}

export function cardMarketRequest(
  cfg: BackendConfig | undefined,
  input: { query?: string; item?: Record<string, unknown> },
): Promise<BackendResult<CardMarketPayload>> {
  return request<CardMarketPayload>(cfg, "POST", "/api/mcp/card-market", input);
}

export function athleteRequest(cfg: BackendConfig | undefined, slug: string): Promise<BackendResult<AthletePayload>> {
  return request<AthletePayload>(cfg, "GET", `/api/mcp/athlete/${encodeURIComponent(slug)}`);
}
