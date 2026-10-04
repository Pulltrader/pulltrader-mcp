import { describe, it, expect } from 'vitest';
import { run } from '../src/tools/checkKaptureCert';
import { getTool, isDataTool } from '../src/tools/registry';

const backend = (status: string) => ({
  baseUrl: 'https://backend.example.test', secret: 'test',
  fetchImpl: (async (_url: unknown, options: RequestInit) => {
    expect(JSON.parse(String(options.body)).cert).toBe('00123');
    return new Response(JSON.stringify({ kapture: { cert: '00123', status, checkedAt: '2026-09-23T00:00:00Z', expiresAt: '2026-09-23T00:05:00Z' } }), { status: 200 });
  }) as typeof fetch,
});

describe('Kapture MCP', () => {
  it('registers with upstream abuse budgets', () => {
    expect(getTool('check_kapture_cert')).toBeDefined();
    expect(isDataTool('check_kapture_cert')).toBe(true);
  });
  it('preserves string certs and offers voluntary recovery only for stolen matches', async () => {
    const result = await run({ cert: ' 00123 ' }, { backend: backend('STOLEN') });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('voluntary recovery');
      expect(result.structured).toMatchObject({ possessionKnown: false, recoveryUrl: 'https://app.pulltrader.app/kapture/return?cert=00123' });
    }
    const clean = await run({ cert: '00123' }, { backend: backend('CLEAN') });
    if (clean.ok) expect(clean.structured).toMatchObject({ recoveryUrl: null });
  });
  it('never treats unknown states or missing configuration as clean', async () => {
    expect((await run({ cert: 123 }, {})).ok).toBe(false);
    expect((await run({ cert: '00123' }, {})).ok).toBe(false);
    expect((await run({ cert: '00123' }, { backend: backend('UNKNOWN') })).ok).toBe(false);
  });
});
