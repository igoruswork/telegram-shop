import test from 'node:test';
import assert from 'node:assert/strict';
import { utils, write } from 'xlsx';
import { parsePrice, normalizeBarcode, detectPriceColumns, previewPriceImport, savePriceChanges } from '../src/lib/pricing.js';
import { readPriceWorkbook } from '../src/lib/priceWorkbook.js';
import { isComingSoon, normalizeProductBadge } from '../src/lib/productDisplay.js';
import { calculateDiscountedPrice, getBrandDiscount, normalizeBrandDiscounts } from '../src/lib/brandDiscounts.js';

const products = [{ id: 1, sku: '00123', price: 10 }, { id: 2, sku: '456', price: 20 }, { id: 3, sku: '00123', price: 12 }];
test('prices accept Ukrainian decimals and reject missing, negative and malformed amounts', () => {
  for (const [value, price] of [['1 234,50 грн', 1234.5], ['0', 0], [2.45, 2.45], ['150.00', 150]]) assert.equal(parsePrice(value), price);
  for (const value of ['', null, '-1', Infinity, '12abc', '1e3', '12.345', '1,2,3', true, 1e12]) assert.equal(parsePrice(value), null);
});
test('barcodes retain leading zeros, reject unsafe numeric identifiers', () => {
  assert.equal(normalizeBarcode(' 00123 '), '00123');
  assert.equal(normalizeBarcode(123), '123');
  assert.equal(normalizeBarcode(1e20), '');
});
test('import updates all matching cards, leaves unknown rows and identical prices alone', () => {
  const rows = [['Штрихкод', 'Вартість'], ['00123', '15,50'], ['456', 20], ['999', 100], ['', 9], ['777', -1]];
  const result = previewPriceImport(rows, products, detectPriceColumns(rows));
  assert.deepEqual(result.changes, [{ id: 1, price: 15.5 }, { id: 3, price: 15.5 }]);
  assert.deepEqual(result.results.map((r) => r.status), ['До оновлення', 'Без змін', 'Штрихкод не знайдено', 'Немає коректного штрихкоду', 'Некоректна ціна']);
});
test('all duplicate spreadsheet barcodes are skipped regardless of price validity', () => {
  const rows = [['00123', 5], ['00123', 'oops'], ['456', 0]];
  const result = previewPriceImport(rows, products, { barcode: 0, price: 1, header: false });
  assert.deepEqual(result.changes, [{ id: 2, price: 0 }]);
  assert.ok(result.results.slice(0, 2).every((r) => r.status.includes('Дублікат')));
  assert.throws(() => previewPriceImport(rows, products, { barcode: 0, price: 0 }), /різні/);
});
test('column mapping supports reversed headers and null current prices', () => {
  const rows = [['Ціна, грн', 'EAN'], [0, '456']];
  const result = previewPriceImport(rows, [{ id: 2, sku: '456', price: null }], { barcode: 1, price: 0, header: true });
  assert.deepEqual(result.changes, [{ id: 2, price: 0 }]);
});
for (const bookType of ['xlsx', 'xls']) test(`reads real ${bookType} bytes, text/padded barcodes and formatted currency`, () => {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([['Штрихкод', 'Вартість'], ['00123', 25.5], [123, 30]]);
  sheet.A3.z = '00000'; sheet.B2.z = '#,##0.00 "грн"';
  utils.book_append_sheet(workbook, sheet, 'Ціни');
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([['інший']]), 'Інше');
  const sheets = readPriceWorkbook(write(workbook, { type: 'array', bookType }));
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].rows[1][0], '00123');
  assert.equal(sheets[0].rows[1][1], 25.5);
  assert.equal(sheets[0].rows[2][0], '00123');
});
test('saving reports partial failures and never retries successful writes', async () => {
  const changes = Array.from({ length: 12 }, (_, id) => ({ id, price: id + 10 }));
  const attempts = []; const progress = [];
  const result = await savePriceChanges(changes, async (change) => { attempts.push(change.id); if (change.id === 5) throw new Error('RLS'); }, (n) => progress.push(n));
  assert.equal(result.saved.length, 11); assert.equal(result.failed[0].id, 5);
  assert.equal(attempts.length, 12); assert.deepEqual(progress, [5, 10, 12]);
});
test('coming-soon badge accepts punctuation/case variants without matching unrelated badges', () => {
  for (const badge of ['Скоро..', ' скоро… ', 'СКОРО', 'Coming soon']) assert.equal(isComingSoon({ badge }), true);
  for (const badge of ['Хіт', 'Акція', null, 'Скороход']) assert.equal(isComingSoon({ badge }), false);
});
test('standard badges are stored and displayed in English', () => {
  assert.equal(normalizeProductBadge('Хіт'), 'Hit');
  assert.equal(normalizeProductBadge('Новинка'), 'New');
  assert.equal(normalizeProductBadge('Акція'), 'Sale');
  assert.equal(normalizeProductBadge('Скоро..'), 'Coming soon');
  assert.equal(normalizeProductBadge('Custom'), 'Custom');
});
test('brand discounts default to zero and calculate a rounded customer price', () => {
  const discounts = normalizeBrandDiscounts({ Balme: '50%', Other: '30,5', Bad: 101 });
  assert.deepEqual(discounts, { Balme: 50, Other: 30.5 });
  assert.equal(getBrandDiscount(discounts, 'Missing'), 0);
  assert.equal(calculateDiscountedPrice(248, discounts.Balme), 124);
  assert.equal(calculateDiscountedPrice(199.99, discounts.Other), 138.99);
});
