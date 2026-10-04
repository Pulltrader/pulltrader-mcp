import { checkCoarseLimit, type AbuseEnv } from './abuseGuard';

export const SELLER_RESOURCE = 'https://mcp.pulltrader.app/seller/mcp';
export const SELLER_METADATA_PATH = '/.well-known/oauth-protected-resource/seller/mcp';
const metadataUrl = `https://mcp.pulltrader.app${SELLER_METADATA_PATH}`;
const scope = 'seller:read';
const origins = new Set(['https://app.pulltrader.app', 'https://claude.ai', 'https://chatgpt.com']);
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Retry-After',
};
interface SellerEnv extends AbuseEnv { PULLTRADER_API_BASE?: string; SCOUT_MCP_SECRET?: string; }
const reply = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...headers, ...extra } });

export function sellerMetadata(): Response {
  return new Response(JSON.stringify({ resource: SELLER_RESOURCE, authorization_servers: ['https://auth.pulltrader.app/'],
    scopes_supported: [scope], bearer_methods_supported: ['header'], resource_name: 'Pulltrader seller workspace' }), { headers });
}

async function boundedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new Error('too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

// This is the edge transport for the same MCP resource. Its backend validates
// the MCP audience; the token is never sent to public tools or other APIs.
export async function sellerRequest(request: Request, env: SellerEnv, doFetch: typeof fetch = fetch): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && !origins.has(origin)) return reply(403, 'Origin not allowed.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, 'Use POST for seller MCP.', { Allow: 'POST, OPTIONS' });
  if (new URL(request.url).search) return reply(400, 'Query parameters are not supported.');
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization) || authorization.length > 8192) {
    return reply(401, 'Connect your Pulltrader seller account.', { 'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}", scope="${scope}"` });
  }
  if (!env.PULLTRADER_API_BASE || !env.SCOUT_MCP_SECRET) return reply(503, 'Seller MCP is unavailable.');
  const limit = await checkCoarseLimit(env, request.headers.get('CF-Connecting-IP') || 'unknown');
  if (!limit.allowed) return reply(429, 'Retry shortly.', { 'Retry-After': String(limit.resetInSeconds) });
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) return reply(415, 'Use application/json.');
  let body: Uint8Array;
  try { body = await boundedBody(request); } catch { return reply(413, 'Request too large.'); }
  try {
    const target = new URL('/api/mcp/seller', env.PULLTRADER_API_BASE);
    if (target.protocol !== 'https:') return reply(503, 'Seller MCP is unavailable.');
    const response = await doFetch(target.toString(), { method: 'POST', body,
      headers: { 'Content-Type': 'application/json', Authorization: authorization, 'X-Scout-MCP-Secret': env.SCOUT_MCP_SECRET },
      redirect: 'manual', signal: AbortSignal.timeout(45000) });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return reply(502, 'Seller MCP is unavailable.'); }
    const out = new Headers(headers);
    for (const name of ['WWW-Authenticate', 'Retry-After']) {
      const value = response.headers.get(name); if (value) out.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: out });
  } catch { return reply(502, 'Seller MCP is unavailable. Retry later.'); }
}
