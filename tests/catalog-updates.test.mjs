import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProductChanges, sortProducts, createProductEventBuffer, createCatalogCacheWriter } from '../src/lib/catalogUpdates.js';

const product = (id, order = id) => ({ id, name: `Product ${id}`, view: true, price: 10, number_sites: order });
const update = (value) => ({ eventType: 'UPDATE', new: value });

test('price-only bursts preserve order and unchanged object identities', () => {
  const current = [product(3), product(2), product(1)];
  const next = applyProductChanges(current, [update({ id: 2, price: 20 }), update({ id: 2, price: 30 })]);
  assert.deepEqual(next.map((p) => p.id), [3, 2, 1]);
  assert.equal(next[1].price, 30);
  assert.equal(next[0], current[0]);
  assert.equal(next[2], current[2]);
  assert.equal(applyProductChanges(next, [update({ id: 2, price: 30 })]), next);
});

test('hide, delete, restore, insertion and reorder retain event ordering', () => {
  const current = sortProducts([product(1), product(2), product(3)]);
  const next = applyProductChanges(current, [
    update({ id: 3, view: false }),
    { eventType: 'DELETE', old: { id: 2 } },
    update(product(3, 5)),
    { eventType: 'INSERT', new: product(4, 4) },
    update({ id: 1, number_sites: 10 }),
  ]);
  assert.deepEqual(next.map((p) => p.id), [1, 3, 4]);
  assert.equal(applyProductChanges(next, [{ eventType: 'DELETE', old: { id: 999 } }]), next);
});

test('events received during a fetch can be replayed over its stale snapshot', () => {
  const snapshot = [product(2), product(1)];
  const events = [update({ id: 1, price: 99 }), { eventType: 'DELETE', old: { id: 2 } }];
  const next = applyProductChanges(snapshot, events);
  assert.deepEqual(next.map((p) => [p.id, p.price]), [[1, 99]]);
  assert.equal(applyProductChanges(next, events), next);
});

test('606 realtime updates produce one state batch and one deferred cache write', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let current = sortProducts(Array.from({ length: 606 }, (_, i) => product(i + 1)));
  let batches = 0;
  const writes = [];
  const writer = createCatalogCacheWriter((products) => writes.push(products));
  const buffer = createProductEventBuffer((events) => {
    batches++;
    current = applyProductChanges(current, events);
    writer.schedule(current);
  });
  for (const p of current) buffer.push(update({ id: p.id, price: 42 }));
  assert.equal(batches, 0);
  t.mock.timers.tick(100);
  assert.equal(batches, 1);
  assert.equal(writes.length, 0);
  t.mock.timers.tick(500);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].every((p) => p.price === 42));
});

test('continuous cache updates checkpoint by maxWait and pagehide flush keeps latest data', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const writer = createCatalogCacheWriter((value) => writes.push(value));
  for (let i = 0; i < 5; i++) { writer.schedule(i); t.mock.timers.tick(400); }
  assert.deepEqual(writes, [4]);
  writer.schedule(5);
  writer.flush();
  writer.flush();
  t.mock.timers.tick(3000);
  assert.deepEqual(writes, [4, 5]);
});

test('flushing a pending event before cache flush persists its latest change', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const writer = createCatalogCacheWriter((value) => writes.push(value));
  const buffer = createProductEventBuffer((events) => writer.schedule(applyProductChanges([product(1)], events)));
  buffer.push(update({ id: 1, price: 77 }));
  buffer.flush();
  writer.flush();
  buffer.cancel();
  t.mock.timers.tick(3000);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].price, 77);
});
