// Privacy-safe usage analytics.
//
// We capture ONLY operational, non-PII signals: tool name, success/error state,
// error code, latency, and a coarse anonymous request fingerprint. We never log
// card queries, prices, IP addresses, tokens, or natural-language input.
// See docs/PRIVACY.md.

export interface AnalyticsEvent {
  event: string;
  tool?: string;
  ok?: boolean;
  errorCode?: string;
  latencyMs?: number;
  method?: string;
}

export interface AnalyticsEnv {
  DISABLE_ANALYTICS?: string;
  POSTHOG_HOST?: string;
  POSTHOG_API_KEY?: string;
}

/**
 * Fire-and-forget capture. Returns a promise the caller can pass to
 * ctx.waitUntil. Never throws. No-op unless PostHog is configured.
 */
export async function capture(env: AnalyticsEnv, ev: AnalyticsEvent, anonId: string): Promise<void> {
  try {
    if (env.DISABLE_ANALYTICS === "1") return;
    if (!env.POSTHOG_HOST || !env.POSTHOG_API_KEY) return;
    const body = {
      api_key: env.POSTHOG_API_KEY,
      event: ev.event,
      distinct_id: anonId,
      properties: {
        $source: "mcp",
        tool: ev.tool,
        ok: ev.ok,
        error_code: ev.errorCode,
        latency_ms: ev.latencyMs,
        method: ev.method,
        server: "pulltrader-mcp",
      },
    };
    await fetch(`${env.POSTHOG_HOST.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Analytics must never affect the request.
  }
}

/**
 * Derive a coarse, non-reversible anonymous id from connection metadata so we
 * can count distinct callers without storing IPs. Hash is truncated.
 */
export async function anonymousId(seed: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`pulltrader-mcp:${seed}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest).slice(0, 8);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "anonymous";
  }
}
