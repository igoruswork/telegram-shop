import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';

test('coming-soon UI and checkout reject stale cart snapshots', async () => {
  const httpServer = createHttpServer();
  const server = await createServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'custom' });
  try {
    const { CatalogProductCard } = await server.ssrLoadModule('/src/components/CatalogProductCard.jsx');
    const product = { id: 1, name: 'Test item', sku: '00123', badge: 'Скоро..', price: 12345, view: true };
    const render = (p) => renderToStaticMarkup(React.createElement(CatalogProductCard, {
      product: p, qty: 2, defaultBrandColor: '#075985', onProductClick() {}, onAddToCart() {}, onUpdateQty() {},
    }));
    const soon = render(product);
    assert.match(soon, /Coming soon/);
    assert.match(soon, /Незабаром у продажу/);
    assert.doesNotMatch(soon, /product-card-price|catalog-qty-btn|product-card-cart-mark/);
    const available = render({ ...product, badge: 'Хіт' });
    assert.match(available, /product-card-price/);
    assert.match(available, /catalog-qty-btn/);

    const api = await server.ssrLoadModule('/src/lib/supabase.js');
    const original = api.supabase.from;
    let writes = 0;
    let currentProduct = product;
    api.supabase.from = () => ({
      select: () => ({ in: async () => ({ data: [currentProduct], error: null }) }),
      insert: () => { writes++; throw new Error('Unexpected write'); },
    });
    const order = { items: [{ ...product, badge: undefined, qty: 1 }], total: product.price };
    try {
      await assert.rejects(api.createOrder(order), /недоступний/);
      currentProduct = { ...product, badge: null, price: 99 };
      await assert.rejects(api.createOrder(order), /Ціна.*змінилася/);
      currentProduct = { ...product, badge: null, view: false };
      await assert.rejects(api.createOrder(order), /недоступний/);
      assert.equal(writes, 0);
    } finally { api.supabase.from = original; }
  } finally { await server.close(); }
});
