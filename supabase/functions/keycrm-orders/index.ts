import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { CrmError, createCrmOrder, makeCrmClient, positiveId, publicRecord, reconcileCrmOrder } from './core.mjs';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-admin-phone',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Метод не підтримується.' }, 405);
  const phone = request.headers.get('x-admin-phone') || '';
  if (!/^\+380\d{9}$/.test(phone)) return json({ error: 'Увійдіть за номером адміністратора.' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Сервер інтеграції ще не налаштований.' }, 503);

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // Explicit product choice: preserve the existing phone-only login. This
    // checks membership, NOT identity: a caller who knows a number can spoof it.
    // Do not trust the publicly writable app_settings list for each request.
    const { data: admin, error: adminError } = await db.from('keycrm_admins').select('phone').eq('phone', phone).maybeSingle();
    if (adminError) return json({ error: 'Потрібно застосувати міграцію інтеграції KeyCRM.' }, 503);
    if (!admin) return json({ error: 'Номер не додано до серверного списку адміністраторів CRM.' }, 403);

    const apiKey = Deno.env.get('KEYCRM_API_KEY')?.trim();
    const must = (result: { data: any; error: any }) => {
      if (result.error) throw new Error('Database operation failed');
      return result.data;
    };
    const store = {
      async readOrder(id: string) {
        // Fetch only the saved line items; never load buyer PII for the export.
        return must(await db.from('orders').select('id, items').eq('id', id).maybeSingle());
      },
      async readExport(id: string) {
        return must(await db.from('keycrm_order_exports').select('*').eq('local_order_id', id).maybeSingle());
      },
      async claim(id: string, attempt: string, actor: string) {
        return must(await db.rpc('claim_keycrm_order', { p_order_id: id, p_attempt_id: attempt, p_actor_phone: actor }));
      },
      async transition(row: any, from: string[], patch: Record<string, unknown>) {
        return must(await db.from('keycrm_order_exports')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('local_order_id', row.local_order_id).eq('attempt_id', row.attempt_id)
          .in('state', from).select('*').maybeSingle());
      },
    };

    if (request.method === 'GET') {
      const ids = new URL(request.url).searchParams.get('order_ids')?.split(',').filter(Boolean) || [];
      if (ids.length > 100 || ids.some((id) => !positiveId(id))) return json({ error: 'Некоректні номери чеків.' }, 400);
      let records = [];
      if (ids.length) {
        must(await db.rpc('expire_keycrm_attempts', { p_order_ids: ids }));
        records = must(await db.from('keycrm_order_exports').select('*').in('local_order_id', ids));
      }
      return json({ configured: Boolean(apiKey), records: records.map(publicRecord) });
    }

    if (!apiKey) return json({ error: 'Додайте KEYCRM_API_KEY у Secrets Edge Function.' }, 503);
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: 'Запит завеликий.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Некоректний JSON.' }, 400); }
    const orderId = positiveId(body?.order_id);
    if (!orderId || !['create', 'reconcile'].includes(body?.action)) return json({ error: 'Некоректна дія або номер чека.' }, 400);
    const startedAt = Date.now();
    const keyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey))))
      .map((value) => value.toString(16).padStart(2, '0')).join('');
    const crm = makeCrmClient({
      apiKey,
      async reserve() {
        const wait = must(await db.rpc('reserve_keycrm_request', { p_key_hash: keyHash }));
        if (!Number.isInteger(wait) || wait < 0 || Date.now() - startedAt + wait > 85000) {
          throw new CrmError('Ліміт запитів KeyCRM зайнятий. Повторіть дію вручну пізніше.');
        }
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      },
    });
    if (body.action === 'reconcile') {
      const crmId = positiveId(body.crm_id);
      if (!crmId || body.confirmed !== true) return json({ error: 'Потрібні CRM-ID та підтвердження ручної перевірки.' }, 400);
      const record = await reconcileCrmOrder({ orderId, crmId, actorPhone: phone, store, crm });
      return json({ record });
    }
    const record = await createCrmOrder({ orderId, actorPhone: phone, attemptId: crypto.randomUUID(), store, crm });
    return json({ record });
  } catch (error) {
    if (error instanceof CrmError) return json({ error: error.message }, 400);
    // Do not log tokens, order payloads, buyer data or upstream response bodies.
    return json({ error: 'Не вдалося підтвердити результат. Оновіть стан перед подальшими діями.' }, 503);
  }
});
