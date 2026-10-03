// No environment access here: dependencies are injected for deterministic tests.
export const CRM_COMMENT = '⌛️⌛️💴💵💶💷';
const API = 'https://openapi.keycrm.app/v1';
const SAFE_REJECTIONS = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);

export class CrmError extends Error {}

export function positiveId(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) return null;
  return text;
}

export function money(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1e12 ? number : null;
}

export function orderItems(order) {
  let items = order?.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = null; }
  }
  if (!Array.isArray(items) || !items.length || items.length > 200) {
    throw new CrmError('Замовлення має містити від 1 до 200 позицій.');
  }
  return items.map((item) => {
    if (typeof item?.sku !== 'string' || !item.sku.trim() || item.sku !== item.sku.trim()
      || /[,\x00-\x1f]/.test(item.sku) || item.sku.length > 255) {
      throw new CrmError('У кожного товару має бути коректний текстовий SKU.');
    }
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 255) {
      throw new CrmError('Перевірте назви товарів у чеку.');
    }
    const quantity = Number(item.qty);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) {
      throw new CrmError('Кількість товару має бути цілим додатним числом.');
    }
    return { sku: item.sku, name: item.name, quantity };
  });
}

export function publicRecord(record) {
  if (!record) return null;
  return Object.fromEntries(['local_order_id', 'state', 'crm_id', 'crm_total', 'message', 'updated_at']
    .map((key) => [key, record[key] ?? null]));
}

export function makeCrmClient({ apiKey, fetchImpl = fetch, reserve, timeoutMs = 20000 }) {
  async function request(path, options = {}) {
    const response = await fetchImpl(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    let data;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, ok: response.ok, data };
  }
  return {
    reserve,
    async offers(skus) {
      const found = new Map();
      for (let offset = 0; offset < skus.length; offset += 50) {
        const batch = skus.slice(offset, offset + 50);
        let lastPage = 1;
        for (let page = 1; page <= lastPage; page++) {
          await reserve();
          const query = new URLSearchParams({ 'filter[sku]': batch.join(','), limit: '50', page: String(page) });
          const response = await request(`/offers?${query}`);
          if (!response.ok || !Array.isArray(response.data?.data)) {
            throw new CrmError(`Не вдалося отримати актуальні ціни KeyCRM (HTTP ${response.status}). POST не виконувався.`);
          }
          lastPage = Number(response.data.last_page ?? 1);
          if (!Number.isSafeInteger(lastPage) || lastPage < page || lastPage > 20) {
            throw new CrmError('Неповна відповідь каталогу KeyCRM. POST не виконувався.');
          }
          for (const offer of response.data.data) {
            if (!batch.includes(offer?.sku)) continue;
            if (found.has(offer.sku)) throw new CrmError('У KeyCRM знайдено кілька пропозицій з однаковим SKU. POST не виконувався.');
            const price = money(offer.price);
            if (price === null) throw new CrmError('KeyCRM повернув некоректну ціну. POST не виконувався.');
            found.set(offer.sku, price);
          }
        }
      }
      if (skus.some((sku) => !found.has(sku))) {
        throw new CrmError('Не для всіх SKU знайдено актуальні ціни KeyCRM. POST не виконувався.');
      }
      return found;
    },
    // reserve() is called BEFORE persisting the posting state. There is no retry.
    postOrder: (payload) => request('/order', { method: 'POST', body: JSON.stringify(payload) }),
    async getOrder(id) {
      await reserve();
      return request(`/order/${id}?include=products`);
    },
  };
}

async function markUncertain(store, row, message, crmId = null) {
  try {
    const saved = await store.transition(row, ['posting', 'needs_review'], {
      state: 'needs_review', message, ...(crmId ? { crm_id: crmId } : {}),
    });
    if (saved) return publicRecord(saved);
  } catch { /* The durable posting state continues to block any new POST. */ }
  return publicRecord({ ...row, state: 'needs_review', message, crm_id: crmId });
}

export async function createCrmOrder({ orderId, actorPhone, attemptId, store, crm }) {
  const order = await store.readOrder(orderId);
  if (!order) throw new CrmError('Чек не знайдено.');
  const claim = await store.claim(orderId, attemptId, actorPhone);
  if (!claim.acquired) return publicRecord(claim.record);
  let row = claim.record;
  let payload;
  try {
    const items = orderItems(order);
    const prices = await crm.offers([...new Set(items.map((item) => item.sku))]);
    payload = {
      source_id: 1,
      manager_comment: CRM_COMMENT,
      buyer: { full_name: null, phone: null },
      products: items.map((item) => ({ ...item, price: prices.get(item.sku) })),
    };
    // Defence in depth if another price adapter is introduced later.
    if (payload.products.some((item) => money(item.price) === null)) {
      throw new CrmError('Актуальні ціни не отримані. POST не виконувався.');
    }
    await crm.reserve();
  } catch (error) {
    const message = error instanceof CrmError ? error.message : 'Не вдалося отримати актуальні ціни. POST не виконувався.';
    const saved = await store.transition(row, ['preflight'], { state: 'failed', message });
    return publicRecord(saved || await store.readExport(orderId));
  }

  // A confirmed, fenced write is mandatory BEFORE the one external side effect.
  // If the write result is lost, do not call POST even if the DB may have saved it.
  try {
    const posting = await store.transition(row, ['preflight'], { state: 'posting', request_payload: payload, message: null });
    if (!posting) return publicRecord(await store.readExport(orderId));
    row = posting;
  } catch {
    return publicRecord({ ...row, state: 'needs_review', message: 'Не підтверджено стан підготовки в Supabase. Перевірте стан; POST не виконувався.' });
  }

  let response;
  try { response = await crm.postOrder(payload); }
  catch { return markUncertain(store, row, 'Відповідь на POST втрачена. Потребує перевірки без повторного створення.'); }

  const crmId = positiveId(response.data?.id);
  // An ID in ANY response may mean an order exists; never unlock that attempt.
  if (!response.ok && SAFE_REJECTIONS.has(response.status) && !crmId) {
    const buyerHint = response.status === 422 ? ' Перевірте, чи KeyCRM дозволяє порожні дані покупця. Дані покупця не підставлялися.' : '';
    const message = `KeyCRM відхилив запит (HTTP ${response.status}).${buyerHint}`;
    try {
      const saved = await store.transition(row, ['posting', 'needs_review'], { state: 'failed', message });
      if (saved) return publicRecord(saved);
    } catch { /* Keep the persistent lock if saving the rejection failed. */ }
    return markUncertain(store, row, 'Не вдалося зберегти відповідь KeyCRM. Потребує перевірки.');
  }
  if (!response.ok || !crmId) {
    return markUncertain(store, row, 'KeyCRM не повернув підтвердження з коректним CRM-ID. Потребує перевірки.', crmId);
  }
  const total = money(response.data.grand_total);
  if (total === null) return markUncertain(store, row, 'CRM-ID отримано, але фактична сума не підтверджена. Потребує перевірки.', crmId);
  try {
    const saved = await store.transition(row, ['posting', 'needs_review'], {
      state: 'created', crm_id: crmId, crm_total: total, crm_products: payload.products,
      message: null, completed_at: new Date().toISOString(),
    });
    if (saved) return publicRecord(saved);
  } catch { /* Even HTTP 201 is not success until Supabase confirms persistence. */ }
  return markUncertain(store, row, 'Замовлення отримало CRM-ID, але результат не збережено. Потребує перевірки.', crmId);
}

function productSignature(products) {
  if (!Array.isArray(products) || !products.length) return null;
  const normalized = [];
  for (const item of products) {
    const price = money(item.price);
    const quantity = Number(item.quantity);
    if (typeof item.sku !== 'string' || price === null || !Number.isSafeInteger(quantity) || quantity < 1) return null;
    normalized.push(JSON.stringify([item.sku, quantity, price]));
  }
  return JSON.stringify(normalized.sort());
}

// A separate, explicit administrator action. It only reads KeyCRM, never POSTs.
export async function reconcileCrmOrder({ orderId, crmId, actorPhone, store, crm }) {
  const row = await store.readExport(orderId);
  if (!row || !['posting', 'needs_review'].includes(row.state) || !row.request_payload) {
    throw new CrmError('Цей чек не потребує прив’язування CRM-ID. Оновіть стан.');
  }
  if (row.crm_id && String(row.crm_id) !== crmId) throw new CrmError('Для цієї спроби вже відомий інший CRM-ID.');
  const response = await crm.getOrder(crmId);
  const data = response.data;
  if (!response.ok || positiveId(data?.id) !== crmId || Number(data?.source_id) !== 1
    || productSignature(data?.products) !== productSignature(row.request_payload.products)
    || money(data?.grand_total) === null) {
    throw new CrmError('CRM-ID, джерело, товари, кількість, ціни або сума не збігаються. Стан не змінено.');
  }
  const saved = await store.transition(row, ['posting', 'needs_review'], {
    state: 'created', crm_id: crmId, crm_total: money(data.grand_total),
    crm_products: row.request_payload.products, message: null,
    completed_at: new Date().toISOString(), reviewed_by_phone: actorPhone,
  });
  if (!saved) throw new CrmError('Стан змінився. Оновіть дані.');
  return publicRecord(saved);
}
