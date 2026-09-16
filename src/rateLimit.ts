// Re-export abuse-guard helpers. Kept as a thin shim so older imports
// (`checkRateLimit`, `__resetRateLimitForTests`) keep working.
export {
  checkRateLimit,
  checkMemoryRateLimit,
  checkCoarseLimit,
  checkDataToolBudget,
  incrementKvCounter,
  __resetRateLimitForTests,
  type AbuseKv,
  type AbuseEnv,
  type AbuseCheckResult,
} from "./abuseGuard";
