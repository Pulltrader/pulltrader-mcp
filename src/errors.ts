// Machine-readable error codes returned in tool results (structuredContent.error)
// and surfaced in the human-readable text. These are stable contract values.
export type ErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_CATEGORY"
  | "UNSUPPORTED_SELLING_METHOD"
  | "UNSUPPORTED_CURRENCY"
  | "FEE_SCHEDULE_UNAVAILABLE"
  | "FEE_SCHEDULE_STALE"
  | "RATE_LIMITED"
  // Data-backed tools (Scout backend bridge):
  | "DATA_BACKEND_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "NOT_FOUND"
  | "NO_DATA"
  | "INTERNAL_ERROR";

export interface ToolError {
  code: ErrorCode;
  message: string;
  field?: string;
}

export function toolError(code: ErrorCode, message: string, field?: string): ToolError {
  return field ? { code, message, field } : { code, message };
}
