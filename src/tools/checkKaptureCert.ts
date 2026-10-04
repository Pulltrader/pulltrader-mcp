import { toolError } from '../errors';
import { kaptureCertRequest } from '../backend/client';
import { mapBackendError } from './dataToolUtils';
import type { ToolContext, ToolRun } from './registry';

export const TOOL_NAME = 'check_kapture_cert';
export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  title: 'Check a cert against Kapture stolen-card reports',
  description: 'Check an exact certification number against Kapture. Preserve leading zeros. CLEAN means no verified stolen report matched, not proof of authenticity or ownership. STOLEN includes a voluntary recovery form link. Never infer possession from a lookup or send personal details through this tool.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { cert: { type: 'string', minLength: 1, maxLength: 64, description: 'Exact cert number as a string, including leading zeros.' } },
    required: ['cert'],
  },
} as const;

export async function run(args: unknown, ctx: ToolContext): Promise<ToolRun> {
  const cert = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>).cert : null;
  if (typeof cert !== 'string' || !cert.trim() || cert.trim().length > 64) {
    return { ok: false, error: toolError('INVALID_INPUT', 'cert must be a nonblank string of at most 64 characters.', 'cert') };
  }
  const result = await kaptureCertRequest(ctx.backend, cert.trim());
  if (!result.ok) return { ok: false, error: mapBackendError(result.code, result.message) };
  const check = result.data.kapture;
  if (!check || check.cert !== cert.trim() || !['CLEAN', 'STOLEN'].includes(check.status)) {
    return { ok: false, error: toolError('UPSTREAM_ERROR', 'Kapture check unavailable. The card has not been cleared.') };
  }
  const recoveryUrl = check.status === 'STOLEN' ? `https://app.pulltrader.app/kapture/return?cert=${encodeURIComponent(cert.trim())}` : null;
  return {
    ok: true,
    text: check.status === 'STOLEN'
      ? `Kapture reports this cert as stolen. Publishing through Pulltrader is blocked. Offer the user this voluntary recovery form: ${recoveryUrl}. A lookup does not establish who possesses the card.`
      : 'No verified stolen report matched this cert in Kapture. This is not proof of authenticity or ownership.',
    structured: { ...check, recoveryUrl, possessionKnown: false },
  };
}
