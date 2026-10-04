import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';
import { sellerRequest, sellerMetadata, SELLER_RESOURCE } from '../src/seller';
import { __resetRateLimitForTests } from '../src/abuseGuard';
const env = { PULLTRADER_API_BASE: 'https://backend.test', SCOUT_MCP_SECRET: 'bridge-secret' };
const request = (headers: Record<string,string> = {}, body = '{}', url = SELLER_RESOURCE) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer a.b.c', ...headers }, body,
});
describe('seller MCP edge boundary', () => {
 beforeEach(()=>__resetRateLimitForTests());
 it('advertises a separate resource, issuer and narrow scope',async()=>{
  expect(await sellerMetadata().json()).toMatchObject({resource:SELLER_RESOURCE,authorization_servers:['https://auth.pulltrader.app/'],scopes_supported:['seller:read']});
 });
 it('challenges missing tokens without touching the backend',async()=>{
  const upstream=vi.fn();const r=await sellerRequest(request({Authorization:''}),env,upstream);
  expect(r.status).toBe(401);expect(r.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource/seller/mcp');expect(upstream).not.toHaveBeenCalled();
 });
 it('rejects hostile origins, query credentials, and oversized input',async()=>{
  const upstream=vi.fn();
  expect((await sellerRequest(request({Origin:'https://hostile.test'}),env,upstream)).status).toBe(403);
  expect((await sellerRequest(request({},'{}',SELLER_RESOURCE+'?access_token=secret'),env,upstream)).status).toBe(400);
  expect((await sellerRequest(request({},'x'.repeat(16385)),env,upstream)).status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
 });
 it('forwards only MCP credentials to the fixed backend resource and disables caching',async()=>{
  const upstream=vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit)=>new Response('{"ok":true}',{headers:{'Set-Cookie':'secret=leak','WWW-Authenticate':'Bearer scope="seller:read"'}}));
  const r=await sellerRequest(request({'X-Consignor-Id':'other','Cookie':'app-token'}),env,upstream);
  const [url,init]=upstream.mock.calls[0]!;
  expect(url).toBe('https://backend.test/api/mcp/seller');expect(init?.redirect).toBe('manual');
  expect(init?.headers).toEqual({'Content-Type':'application/json',Authorization:'Bearer a.b.c','X-Scout-MCP-Secret':'bridge-secret'});
  expect(r.headers.get('Cache-Control')).toBe('no-store');expect(r.headers.get('Set-Cookie')).toBeNull();
 });
 it('does not follow upstream redirects or expose upstream exceptions',async()=>{
  expect((await sellerRequest(request(),env,async()=>new Response(null,{status:302,headers:{Location:'https://hostile.test'}}))).status).toBe(502);
  const r=await sellerRequest(request(),env,async()=>{throw Error('secret');});expect(await r.text()).not.toContain('secret');
 });
 it('routes private endpoint separately without exposing seller tools publicly',async()=>{
  const ctx: ExecutionContext = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {}, exports: {}, abort: vi.fn(), get tracing(): Tracing { throw new Error('Tracing is not used by this fixture'); } };
  const privateResponse=await worker.fetch(request({Authorization:''}),env,ctx);expect(privateResponse.status).toBe(401);
  const publicResponse=await worker.fetch(request({},JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),'https://mcp.pulltrader.app/mcp'),{DISABLE_ANALYTICS:'1'},ctx);
  const body=await publicResponse.text();expect(body).toContain('identify_card');expect(body).not.toContain('list_seller_inventory');
 });
});
