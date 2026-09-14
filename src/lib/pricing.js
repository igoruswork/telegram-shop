export function parsePrice(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 999999999.99
      && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001 ? value : null;
  }
  const text = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '').replace(/(?:грн\.?|₴|uah)$/i, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  return parsePrice(Number(text));
}

export function normalizeBarcode(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : '';
  const text = String(value ?? '').trim();
  return /^(?:null|undefined)$/i.test(text) ? '' : text;
}

const normalizeHeader = (value) => String(value ?? '').toLowerCase().replace(/[\s_\-.,:()₴]/g, '');
const barcodeHeaders = ['штрихкод', 'штрихкодтовару', 'barcode', 'ean', 'ean13', 'sku'];
const priceHeaders = ['ціна', 'вартість', 'цінагрн', 'вартістьгрн', 'price', 'priceuah', 'цена', 'роздрібнаціна'];

export function detectPriceColumns(rows) {
  const first = rows[0] || [];
  const barcode = first.findIndex((value) => barcodeHeaders.includes(normalizeHeader(value)));
  const price = first.findIndex((value) => priceHeaders.includes(normalizeHeader(value)));
  return { barcode: barcode < 0 ? 0 : barcode, price: price < 0 ? 1 : price, header: barcode >= 0 || price >= 0 };
}

export function previewPriceImport(rows, products, { barcode, price, header }) {
  if (barcode === price) throw new Error('Оберіть різні колонки для штрихкоду та ціни.');
  const byBarcode = new Map();
  for (const product of products) {
    const key = normalizeBarcode(product.sku);
    if (key) byBarcode.set(key, [...(byBarcode.get(key) || []), product]);
  }
  const source = rows.map((cells, index) => ({ cells, row: index + 1 }))
    .slice(header ? 1 : 0).filter(({ cells }) => cells.some((cell) => String(cell ?? '').trim()));
  const counts = new Map();
  for (const { cells } of source) {
    const key = normalizeBarcode(cells[barcode]);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const changes = [];
  const results = source.map(({ cells, row }) => {
    const sku = normalizeBarcode(cells[barcode]);
    const nextPrice = parsePrice(cells[price]);
    let status;
    if (!sku) status = 'Немає коректного штрихкоду';
    else if (counts.get(sku) > 1) status = 'Дублікат у файлі — пропущено';
    else if (nextPrice === null) status = 'Некоректна ціна';
    else if (!byBarcode.has(sku)) status = 'Штрихкод не знайдено';
    else {
      const changed = byBarcode.get(sku).filter((p) => p.price === null || Number(p.price) !== nextPrice);
      for (const product of changed) changes.push({ id: product.id, price: nextPrice });
      status = changed.length ? 'До оновлення' : 'Без змін';
    }
    return { row, sku, price: cells[price], status };
  });
  return { changes, results };
}

export async function savePriceChanges(changes, update, onProgress = () => {}) {
  const saved = [];
  const failed = [];
  // Small batches keep requests bounded, with an explicit result for every card.
  for (let offset = 0; offset < changes.length; offset += 5) {
    const batch = changes.slice(offset, offset + 5);
    const results = await Promise.allSettled(batch.map(update));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') saved.push(batch[index]);
      else failed.push({ ...batch[index], error: result.reason?.message || 'Не вдалося зберегти' });
    });
    onProgress(saved.length + failed.length);
  }
  return { saved, failed };
}
