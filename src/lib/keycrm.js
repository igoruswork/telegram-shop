const url = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function keycrmRequest({ phone, orderIds, action, orderId, crmId }) {
  if (!url || !publicKey) throw new Error('Не налаштовано підключення до Supabase.');
  const endpoint = new URL(`${url}/functions/v1/keycrm-orders`);
  if (!action) endpoint.searchParams.set('order_ids', orderIds.map(String).join(','));
  const response = await fetch(endpoint, {
    method: action ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${publicKey}`, apikey: publicKey, 'Content-Type': 'application/json', 'x-admin-phone': phone },
    ...(action ? { body: JSON.stringify({ action, order_id: orderId, ...(crmId ? { crm_id: crmId, confirmed: true } : {}) }) } : {}),
    signal: AbortSignal.timeout(action ? 115000 : 20000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Сервер не повернув очікуваної відповіді. Оновіть стан.'); }
  if (!response.ok) {
    if (response.status === 404) throw new Error('Функцію keycrm-orders ще не розгорнуто в Supabase.');
    throw new Error(data?.error || 'Інтеграція CRM недоступна. Оновіть стан.');
  }
  return data;
}

const markerKey = (orderId) => `keycrm-unconfirmed:${url}:${orderId}`;

export function hasPendingCrmAttempt(orderId) {
  try { return localStorage.getItem(markerKey(orderId)) !== null; } catch { return false; }
}

export function markPendingCrmAttempt(orderId) {
  // If persistent browser storage is unavailable, fail BEFORE the request.
  localStorage.setItem(markerKey(orderId), new Date().toISOString());
}

export function clearPendingCrmAttempt(orderId) {
  try { localStorage.removeItem(markerKey(orderId)); } catch { /* Server state remains authoritative. */ }
}

export function checkedCrmRecord(record, orderId) {
  if (!record || String(record.local_order_id) !== String(orderId)
    || !['preflight', 'posting', 'created', 'failed', 'needs_review'].includes(record.state)) {
    throw new Error('Некоректний стан CRM. Потребує перевірки.');
  }
  if (record.state === 'created' && (!/^[1-9]\d*$/.test(String(record.crm_id))
    || record.crm_total === null || record.crm_total === '' || !Number.isFinite(Number(record.crm_total))
    || Number(record.crm_total) < 0)) {
    throw new Error('Немає підтвердженого CRM-ID або суми. Потребує перевірки.');
  }
  return record;
}
