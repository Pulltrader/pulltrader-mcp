// =============================================================================
// TOOL: identify_card  (data-backed)
// =============================================================================
// Resolve a free-text card description into a structured identity via the Scout
// backend bridge. Read-only.
// =============================================================================

import { toolError } from "../errors";
import type { ToolContext, ToolRun } from "./registry";
import { identifyCardRequest } from "../backend/client";
import { mapBackendError } from "./dataToolUtils";

export const TOOL_NAME = "identify_card";

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: "Identify a trading card from a text description",
  description:
    "Resolve a natural-language trading-card description into structured fields (player/athlete, year, set, card number, parallel, grader, grade, sport/category). " +
    "Use this first when a user names a card in prose and you need its canonical fields before looking up sales or market value. " +
    "Returns a confidence level and which fields were resolved. This does NOT price the card or return sales — use search_card_sales or summarize_card_market for that. Trading cards only.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        minLength: 2,
        description: "The card description to identify, e.g. '2018 Prizm Luka Doncic Silver PSA 10'.",
      },
    },
    required: ["query"],
  },
} as const;

export async function run(args: unknown, ctx: ToolContext): Promise<ToolRun> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, error: toolError("INVALID_INPUT", "Arguments must be an object.") };
  }
  const query = (args as Record<string, unknown>).query;
  if (typeof query !== "string" || query.trim().length < 2) {
    return { ok: false, error: toolError("INVALID_INPUT", "query is required and must be at least 2 characters.", "query") };
  }

  const res = await identifyCardRequest(ctx.backend, query.trim());
  if (!res.ok) {
    return { ok: false, error: mapBackendError(res.code, res.message) };
  }

  const p = res.data;
  const id = p.identity;
  const parts = [id.year, id.set_name, id.player_athlete, id.card_number ? `#${id.card_number}` : null, id.parallel]
    .filter((x): x is string => !!x)
    .join(" ");
  const gradeStr = id.grader || id.grade ? ` (${[id.grader, id.grade].filter(Boolean).join(" ")})` : "";
  const text =
    parts.length > 0
      ? `Identified ${parts}${gradeStr} — ${p.category ?? "uncategorized"}, confidence ${p.confidence} (${p.fields_extracted} fields resolved).`
      : `Could not confidently resolve a card from "${query.trim()}". Try adding the year, set, player, and grade.`;

  return { ok: true, text, structured: p };
}
