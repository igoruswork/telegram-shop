import test from 'node:test';
import assert from 'node:assert/strict';
import { CRM_COMMENT, createCrmOrder, makeCrmClient, money, positiveId, publicRecord, reconcileCrmOrder, validationDetails } from '../supabase/functions/keycrm-orders/core.mjs';

function fixture({ fetcher, transition } = {}) {
  let row = null;
  const calls = [];
  const order = { id: 941, items: [{ sku: '00123', name: 'Товар', qty: 2, price: 999 }], total: 1998, phone: 'PRIVATE', last_name: 'PRIVATE' };
  const store = {
    readOrder: async () => structuredClone(order),
    readExport: async () => row && structuredClone(row),
    claim: async (_id, attempt, actor) => {
      if (row && row.state !== 'failed') return { acquired: false, record: structuredClone(row) };
      row = { local_order_id: 941, attempt_id: attempt, actor_phone: actor, state: 'preflight' };
      return { acquired: true, record: structuredClone(row) };
    },
    transition: async (current, from, patch) => {
      if (transition) await transition(patch, row);
      if (current.attempt_id !== row.attempt_id || !from.includes(row.state)) return null;
      row = { ...row, ...patch };
      return structuredClone(row);
    },
  };
  const crm = makeCrmClient({
    apiKey: 'fake-test-token', reserve: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (fetcher) {
        const result = await fetcher(url, options);
        if (result) return result;
      }
      return Response.json(url.includes('/offers?')
        ? { data: [{ sku: '00123', price: '12.50', purchased_price: 3 }], last_page: 1 }
        : { id: 207456, grand_total: 25 }, { status: 200 });
    },
  });
  let attempt = 0;
  return { store, crm, order, calls, run: () => createCrmOrder({ orderId: '941', actorPhone: 'admin', attemptId: String(++attempt), store, crm }), row: () => row };
}

const posts = (f) => f.calls.filter((call) => call.options.method === 'POST');

test('CRM sends current prices, agreed source/manager/comment/email, without saved buyer data', async () => {
  const f = fixture();
  const before = structuredClone(f.order);
  const result = await f.run();
  assert.equal(result.state, 'created');
  assert.equal(result.crm_id, '207456');
  assert.equal(result.crm_total, 25);
  assert.deepEqual(f.order, before);
  const payload = JSON.parse(posts(f)[0].options.body);
  assert.deepEqual(payload, {
    source_id: 51, manager_id: 33, manager_comment: CRM_COMMENT,
    buyer: { full_name: null, phone: null, email: 'b@b.ua' },
    products: [{ sku: '00123', name: 'Товар', quantity: 2, price: 12.5 }],
  });
  assert.equal(posts(f).length, 1);
  assert.equal((await f.run()).state, 'created');
  assert.equal(posts(f).length, 1, 'later click returns persisted result');
  assert.equal(result.request_payload, undefined);
});

test('two simultaneous clicks or devices perform one external POST', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ fetcher: async (url) => { if (url.includes('/offers?')) await gate; } });
  const first = f.run();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await f.run();
  assert.equal(second.state, 'preflight');
  release();
  assert.equal((await first).state, 'created');
  assert.equal(posts(f).length, 1);
});

for (const [description, data] of [
  ['missing SKU', { data: [], last_page: 1 }],
  ['duplicate SKU', { data: [{ sku: '00123', price: 10 }, { sku: '00123', price: 11 }], last_page: 1 }],
  ['null price', { data: [{ sku: '00123', price: null }], last_page: 1 }],
  ['malformed price', { data: [{ sku: '00123', price: 'oops' }], last_page: 1 }],
  ['invalid pagination', { data: [], last_page: 'oops' }],
]) test(`${description} prevents the entire POST`, async () => {
  const f = fixture({ fetcher: async () => Response.json(data) });
  assert.equal((await f.run()).state, 'failed');
  assert.equal(posts(f).length, 0);
});

test('price lookup failure never uses saved receipt price as fallback', async () => {
  const f = fixture({ fetcher: async () => { throw new Error('network'); } });
  assert.equal((await f.run()).state, 'failed');
  assert.equal(posts(f).length, 0);
});

test('all pages and exact SKUs are used; batches contain at most 50 SKUs', async () => {
  const calls = [];
  const skus = Array.from({ length: 51 }, (_, i) => String(i).padStart(5, '0'));
  const crm = makeCrmClient({ apiKey: 'fake', reserve: async () => {}, fetchImpl: async (url) => {
    const query = new URL(url).searchParams;
    const batch = query.get('filter[sku]').split(',');
    const page = Number(query.get('page'));
    calls.push(batch.length);
    return Response.json({ data: batch.slice((page - 1) * 25, page * 25).map((sku) => ({ sku, price: 0 })), last_page: Math.ceil(batch.length / 25) });
  } });
  const prices = await crm.offers(skus);
  assert.equal(prices.size, 51);
  assert.deepEqual(calls, [50, 50, 1]);
  assert.equal(prices.get('00000'), 0);
});

for (const [description, response] of [
  ['lost response', () => { throw new Error('timeout'); }],
  ['HTTP 201 without ID', () => Response.json({ grand_total: 25 }, { status: 201 })],
  ['invalid ID', () => Response.json({ id: 'oops', grand_total: 25 }, { status: 200 })],
  ['HTTP 502', () => new Response('upstream error', { status: 502 })],
  ['HTTP 200 with malformed JSON', () => new Response('not json', { status: 200 })],
  ['missing total', () => Response.json({ id: 207456 }, { status: 201 })],
]) test(`${description} persists needs_review and blocks all subsequent POSTs`, async () => {
  const f = fixture({ fetcher: async (_url, options) => { if (options.method === 'POST') return response(); } });
  assert.equal((await f.run()).state, 'needs_review');
  assert.equal((await f.run()).state, 'needs_review');
  assert.equal(posts(f).length, 1);
});

test('Supabase failure after successful POST is not reported as success or retried', async () => {
  const f = fixture({ transition: async (patch) => {
    if (['created', 'needs_review'].includes(patch.state)) throw new Error('database down');
  } });
  const result = await f.run();
  assert.equal(result.state, 'needs_review');
  assert.equal(result.crm_id, '207456');
  assert.equal(f.row().state, 'posting', 'durable lock survives inability to save review state');
  await f.run();
  assert.equal(posts(f).length, 1);
});

test('unconfirmed posting-state write prevents the external POST', async () => {
  const f = fixture({ transition: async (patch) => { if (patch.state === 'posting') throw new Error('database down'); } });
  assert.equal((await f.run()).state, 'needs_review');
  assert.equal(posts(f).length, 0);
});

test('expired/fenced preflight worker cannot POST after state changed', async () => {
  const f = fixture({ transition: async (patch, row) => { if (patch.state === 'posting') row.state = 'failed'; } });
  await f.run();
  assert.equal(posts(f).length, 0);
});

test('422 rejection never substitutes buyer details or retries automatically', async () => {
  const f = fixture({ fetcher: async (_url, options) => options.method === 'POST'
    ? Response.json({ error: 'buyer required' }, { status: 422 }) : undefined });
  assert.equal((await f.run()).state, 'failed');
  assert.equal(posts(f).length, 1);
  assert.deepEqual(JSON.parse(posts(f)[0].options.body).buyer, { full_name: null, phone: null, email: 'b@b.ua' });
  await f.run();
  assert.equal(posts(f).length, 2, 'only a new explicit invocation retries a definitive rejection');
});

test('422 preserves the actual field error without guessing it is the buyer', async () => {
  const f = fixture({ fetcher: async (_url, options) => options.method === 'POST'
    ? Response.json({ message: 'The given data was invalid.', errors: { source_id: ['The selected source id is invalid.'] } }, { status: 422 }) : undefined });
  const result = await f.run();
  assert.equal(result.state, 'failed');
  assert.match(result.message, /source_id: The selected source id is invalid/);
  assert.doesNotMatch(result.message, /покупця/);
  assert.equal(f.row().message, result.message, 'diagnostic survives a later status GET');
  assert.equal(posts(f).length, 1);
});

test('buyer validation is reported only when it appears in the real API response', async () => {
  const f = fixture({ fetcher: async (_url, options) => options.method === 'POST'
    ? Response.json({ errors: { 'buyer.full_name': ['At least one buyer field is required.'], 'products.0.quantity': ['Must be positive.'] } }, { status: 422 }) : undefined });
  const result = await f.run();
  assert.match(result.message, /buyer.full_name: At least one buyer field is required/);
  assert.match(result.message, /products.0.quantity: Must be positive/);
  assert.equal(posts(f).length, 1);
  assert.deepEqual(JSON.parse(posts(f)[0].options.body).buyer, { full_name: null, phone: null, email: 'b@b.ua' });
});

test('validation diagnostics are bounded and redact credentials before persistence', () => {
  const secret = 'fake-test-token';
  const detail = validationDetails({ errors: { buyer: [`bad ${secret}, Bearer other-token, ghp_othersecret, test@example.com`],
    products: ['x'.repeat(3000), 'second', 'third', 'fourth', 'fifth', 'sixth'] }, request: { Authorization: secret } }, secret);
  assert.doesNotMatch(detail, /fake-test-token|other-token|ghp_othersecret|test@example.com|Authorization/);
  assert.match(detail, /\[приховано\]/);
  assert.ok(detail.length <= 1200);
  assert.equal(validationDetails({ message: '<html>Gateway error</html>' }, secret), '');
  assert.equal(validationDetails({ error: 'buyer required' }, secret), 'buyer required');
  assert.equal(validationDetails({ errors: ['Invalid request'] }, secret), 'Invalid request');
  assert.equal(validationDetails(null, secret), '');
});

test('old generic 422 records no longer present the buyer guess as a diagnosis', () => {
  const record = publicRecord({ local_order_id: 941, state: 'failed', message: 'KeyCRM відхилив запит (HTTP 422). Перевірте, чи KeyCRM дозволяє порожні дані покупця. Дані покупця не підставлялися.' });
  assert.match(record.message, /Точна причина цієї попередньої спроби не збережена/);
  assert.equal(record.state, 'failed');
});

test('even non-2xx containing an order ID stays locked', async () => {
  const f = fixture({ fetcher: async (_url, options) => options.method === 'POST'
    ? Response.json({ id: 207456 }, { status: 422 }) : undefined });
  assert.equal((await f.run()).state, 'needs_review');
  await f.run();
  assert.equal(posts(f).length, 1);
});

for (const savedSource of [1, 51]) test(`manual reconciliation matches frozen source ${savedSource}, including legacy attempts`, async () => {
  let sourceId = savedSource === 1 ? 51 : 1;
  const f = fixture({ fetcher: async (url, options) => {
    if (options.method === 'POST') throw new Error('timeout');
    if (url.includes('/order/')) return Response.json({
      id: 207456, source_id: sourceId, grand_total: 25,
      products: [{ sku: '00123', quantity: 2, price: '12.50' }],
    });
  } });
  await f.run();
  // Model a persisted request from the corresponding deployed configuration.
  f.row().request_payload.source_id = savedSource;
  const reconcile = () => reconcileCrmOrder({ orderId: '941', crmId: '207456', actorPhone: 'admin', store: f.store, crm: f.crm });
  await assert.rejects(reconcile(), /не збігаються/);
  assert.equal(f.row().state, 'needs_review');
  sourceId = savedSource;
  assert.equal((await reconcile()).state, 'created');
  assert.equal(posts(f).length, 1);
});

test('manual reconciliation cannot guess a missing source in the frozen request', async () => {
  const f = fixture({ fetcher: async (url, options) => {
    if (options.method === 'POST') throw new Error('timeout');
    if (url.includes('/order/')) return Response.json({
      id: 207456, source_id: 51, grand_total: 25,
      products: [{ sku: '00123', quantity: 2, price: '12.50' }],
    });
  } });
  await f.run();
  delete f.row().request_payload.source_id;
  await assert.rejects(reconcileCrmOrder({ orderId: '941', crmId: '207456', actorPhone: 'admin', store: f.store, crm: f.crm }), /не збігаються/);
  assert.equal(f.row().state, 'needs_review');
  assert.equal(posts(f).length, 1);
});

test('invalid item quantities/barcodes prevent any price query or POST', async () => {
  for (const patch of [{ qty: 0 }, { qty: 1.5 }, { sku: 123 }, { sku: '12,34' }]) {
    const f = fixture();
    Object.assign(f.order.items[0], patch);
    assert.equal((await f.run()).state, 'failed');
    assert.equal(f.calls.length, 0);
  }
});

test('identifiers and prices reject null/unsafe coercions', () => {
  for (const value of [0, -1, '001', '1.5', 1e20, null, true]) assert.equal(positiveId(value), null);
  for (const value of [null, '', ' ', false, Infinity, -1, '1e4']) assert.equal(money(value), null);
});
