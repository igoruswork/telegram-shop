import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

test('Edge handler enforces the server phone list on reads and writes; status cannot create orders', async () => {
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  let handler;
  let allowed = false;
  let networkCalls = 0;
  const tables = [];
  const rpcCalls = [];
  globalThis.__keycrmTestClient = () => ({
    from(table) {
      tables.push(table);
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: allowed ? { phone: '+380000000000' } : null, error: null }; },
        async in() { return { data: [], error: null }; },
      };
    },
    async rpc(name) { rpcCalls.push(name); return { data: null, error: null }; },
  });
  globalThis.Deno = {
    env: { get: (key) => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake', KEYCRM_API_KEY: 'fake' })[key] },
    serve: (callback) => { handler = callback; },
  };
  globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected external request'); };
  try {
    let source = await readFile(new URL('../supabase/functions/keycrm-orders/index.ts', import.meta.url), 'utf8');
    source = source.replace(/import \{ createClient \} from '[^']+';/, 'const createClient = globalThis.__keycrmTestClient;');
    source = source.replace("'./core.mjs'", JSON.stringify(new URL('../supabase/functions/keycrm-orders/core.mjs', import.meta.url).href));
    const { code } = await transformWithEsbuild(source, 'index.ts');
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const request = (method, { phone = '+380000000000', query = '', body } = {}) => handler(new Request(`https://example.invalid/keycrm-orders${query}`, {
      method, headers: { 'x-admin-phone': phone, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    assert.equal((await request('OPTIONS')).status, 204);
    assert.equal((await request('GET', { phone: '' })).status, 401);
    assert.equal((await request('GET')).status, 403);
    assert.equal((await request('POST', { body: { action: 'create', order_id: 941 } })).status, 403);
    allowed = true;
    const status = await request('GET', { query: '?order_ids=941' });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { configured: true, records: [] });
    assert.deepEqual(rpcCalls, ['expire_keycrm_attempts']);
    assert.equal((await request('POST', { body: { action: 'reconcile', order_id: 941, crm_id: 207456 } })).status, 400);
    assert.equal((await request('POST', { body: { action: 'automatic', order_id: 941 } })).status, 400);
    assert.equal((await request('GET', { query: '?order_ids=bad' })).status, 400);
    assert.equal((await request('DELETE')).status, 405);
    assert.equal(networkCalls, 0);
    assert.ok(!tables.includes('app_settings'), 'public settings cannot grant CRM access per request');
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    delete globalThis.__keycrmTestClient;
  }
});
