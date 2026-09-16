import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopNavigation } from '../src/lib/shopNavigation.js';

function browser() {
  const entries = [{ unrelated: true }];
  let index = 0;
  const listeners = new Set();
  const travel = (step) => {
    index = Math.max(0, Math.min(entries.length - 1, index + step));
    listeners.forEach((fn) => fn({ state: entries[index] }));
  };
  return {
    history: {
      get state() { return entries[index]; },
      replaceState(value) { entries[index] = structuredClone(value); },
      pushState(value) { entries.splice(++index, Infinity, structuredClone(value)); },
      back() { travel(-1); },
      forward() { travel(1); },
    },
    addEventListener(_, fn) { listeners.add(fn); },
    removeEventListener(_, fn) { listeners.delete(fn); },
  };
}

test('product, browser Back/Forward and cart preserve catalog search, filters and scroll', () => {
  const host = browser();
  const navigation = createShopNavigation(host);
  const stop = navigation.start();
  const catalogState = { search: 'shampoo', activeCategory: 'Brand', activeSubCategory: 'Hair', scrollY: 1300 };
  navigation.saveCatalogState(catalogState);
  navigation.openProduct({ id: 7, name: 'Shampoo' });
  navigation.openCart();
  navigation.back();
  assert.equal(navigation.getState().page, 'product');
  assert.equal(navigation.getState().cartOpen, false);
  host.history.back();
  assert.equal(navigation.getState().page, 'catalog');
  assert.deepEqual(navigation.getState().catalogState, catalogState);
  host.history.forward();
  assert.equal(navigation.getState().selectedProduct.id, 7);
  assert.equal(host.history.state.unrelated, true);
  stop();
});

test('reload restores route and logout invalidates older navigation entries', () => {
  const host = browser();
  let navigation = createShopNavigation(host);
  const stop = navigation.start();
  navigation.saveCatalogState({ search: 'private search' });
  navigation.openAdmin('pricing');
  stop();
  navigation = createShopNavigation(host);
  navigation.start();
  assert.equal(navigation.getState().initialAdminSection, 'pricing');
  navigation.reset();
  host.history.back();
  assert.equal(navigation.getState().page, 'catalog');
  assert.equal(navigation.getState().catalogState, null);
  host.history.forward();
  assert.equal(navigation.getState().page, 'catalog');
});
