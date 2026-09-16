// Money / rounding helpers shared across the Scout domain.
//
// round2 matches the rounding used by both the MCP fee engine
// (cloudflare-workers/pulltrader-mcp/src/fees/calculator.ts) and the backend
// payout calculator (pulltrader-backend/utils/payoutCalculator.js):
// round-half-up at the cent. Keeping a single implementation here is what lets
// the fee engine and payout math agree to the cent.

/** Round to cents (2 dp), round-half-up, with epsilon to avoid 1.005 -> 1.00. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Coerce an unknown numeric-ish value to a finite number, else fallback. */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}
