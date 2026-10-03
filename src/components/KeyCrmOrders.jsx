import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  checkedCrmRecord, clearPendingCrmAttempt, hasPendingCrmAttempt,
  keycrmRequest, markPendingCrmAttempt,
} from '../lib/keycrm';
import './KeyCrmOrders.css';

const CrmContext = createContext(null);
const uncertain = (id, message) => ({ local_order_id: id, state: 'needs_review', message });
const settled = (record) => ['created', 'failed'].includes(record.state);

export function KeyCrmOrders({ orderIds, phone, children }) {
  const [records, setRecords] = useState({});
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState({});
  const locks = useRef(new Set());
  const generation = useRef(0);
  const actor = useRef(phone);
  actor.current = phone;
  const idsKey = orderIds.map(String).join(',');

  useEffect(() => {
    actor.current = phone;
    setReady(false);
    setRecords({});
    return () => { actor.current = null; generation.current += 1; };
  }, [phone]);

  const refresh = useCallback(async () => {
    if (!phone) return;
    const current = ++generation.current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const ids = idsKey ? idsKey.split(',') : [];
      const data = await keycrmRequest({ phone, orderIds: ids });
      if (!Array.isArray(data.records) || typeof data.configured !== 'boolean') throw new Error('Некоректна відповідь інтеграції CRM.');
      const next = {};
      for (const record of data.records) {
        if (!ids.includes(String(record.local_order_id))) throw new Error('Неочікуваний номер чека у відповіді.');
        next[record.local_order_id] = checkedCrmRecord(record, record.local_order_id);
      }
      if (current !== generation.current) return;
      for (const record of Object.values(next)) if (settled(record)) clearPendingCrmAttempt(record.local_order_id);
      setRecords(next);
      setConfigured(data.configured);
      setReady(true);
    } catch (cause) {
      if (current === generation.current) setError(cause.message || 'Не вдалося отримати стан CRM.');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [phone, idsKey]);

  // Read-only status check. No effect, checkout hook or timer can create orders.
  useEffect(() => { refresh(); }, [refresh]);

  async function runAction(orderId, action, crmId) {
    if (!ready || !configured || !phone || locks.current.has(String(orderId))) return;
    const existing = records[orderId];
    if (action === 'create' && (hasPendingCrmAttempt(orderId) || (existing && existing.state !== 'failed'))) return;
    locks.current.add(String(orderId));
    setBusy((previous) => ({ ...previous, [orderId]: true }));
    // Invalidate in-flight GETs so stale reads cannot overwrite this result.
    ++generation.current;
    setLoading(false);
    if (action === 'create') {
      try { markPendingCrmAttempt(orderId); }
      catch {
        setError('Дозвольте локальне сховище браузера для безпечної передачі замовлення. Запит не надсилався.');
        locks.current.delete(String(orderId));
        setBusy((previous) => ({ ...previous, [orderId]: false }));
        return;
      }
      setRecords((previous) => ({ ...previous, [orderId]: { local_order_id: orderId, state: 'preflight' } }));
    }
    try {
      const data = await keycrmRequest({ phone, action, orderId, crmId });
      const record = checkedCrmRecord(data.record, orderId);
      if (settled(record)) clearPendingCrmAttempt(orderId);
      // Preserve results of concurrent orders, but not a replaced shop user.
      if (actor.current === phone) {
        setRecords((previous) => ({ ...previous, [orderId]: record }));
      }
    } catch (cause) {
      if (actor.current === phone) {
        setRecords((previous) => ({ ...previous, [orderId]: uncertain(orderId,
          action === 'create' ? 'Результат передачі не підтверджено. Потребує перевірки; повторне створення заблоковане.' : cause.message) }));
      }
    } finally {
      locks.current.delete(String(orderId));
      setBusy((previous) => ({ ...previous, [orderId]: false }));
    }
  }

  return (
    <CrmContext.Provider value={{ records, ready, configured, busy, runAction }}>
      <div className="keycrm-panel">
        <div className="keycrm-panel-heading"><strong>Передача до KeyCRM</strong></div>
          <p>Замовлення передається тільки після натискання кнопки в чеку. Ціни запитуються в KeyCRM перед відправленням.</p>
          <button type="button" className="keycrm-secondary" onClick={refresh} disabled={loading || Object.values(busy).some(Boolean)}>
            {loading ? 'Перевіряємо…' : 'Оновити стан CRM'}
          </button>
          {ready && !configured && <p className="keycrm-warning">На сервері ще не додано KEYCRM_API_KEY.</p>}
        {error && <p className="keycrm-warning" role="alert">{error}</p>}
      </div>
      {children}
    </CrmContext.Provider>
  );
}

export function useKeyCrmRecord(orderId) {
  const context = useContext(CrmContext);
  return context?.records[orderId] || (hasPendingCrmAttempt(orderId)
    ? uncertain(orderId, 'Є непідтверджена спроба. Оновіть стан CRM; повторне створення заблоковане.') : null);
}

export function KeyCrmOrderAction({ orderId }) {
  const context = useContext(CrmContext);
  const record = useKeyCrmRecord(orderId);
  if (!context) return null;
  const { ready, configured, busy, runAction } = context;
  return <CrmOrderControls record={record} enabled={ready && configured} busy={Boolean(busy[orderId])}
    onCreate={() => runAction(orderId, 'create')}
    onReconcile={(crmId) => runAction(orderId, 'reconcile', crmId)} />;
}

export function CrmOrderControls({ record, enabled, busy, onCreate, onReconcile }) {
  const [crmId, setCrmId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const state = record?.state;
  const created = state === 'created';
  const pending = ['preflight', 'posting'].includes(state);
  const review = state === 'needs_review';
  return <div className="keycrm-order" aria-busy={busy}>
    <div aria-live="polite">
      {created && <div className="keycrm-success"><strong>Створено в CRM · #{record.crm_id}</strong>
      </div>}
      {pending && <p>{busy ? 'Отримуємо актуальні ціни та передаємо замовлення…' : 'Спроба ще не завершена. Оновіть стан CRM.'}</p>}
      {review && <strong className="keycrm-warning">Потребує перевірки</strong>}
      {record?.message && <p className={created ? '' : 'keycrm-warning'}>{record.message}</p>}
      {review && record.crm_id && <p>Отриманий CRM-ID: <strong>{record.crm_id}</strong></p>}
    </div>
    {!created && !pending && !review && <>
      <button type="button" className="keycrm-primary" disabled={!enabled || busy} onClick={onCreate}>
        {state === 'failed' ? 'Повторити створення вручну' : 'Створити замовлення в CRM'}
      </button>
      {!enabled && <small>Потрібні вхід адміністратора та доступне підключення до CRM.</small>}
    </>}
    {review && <details className="keycrm-review">
      <summary>Прив’язати знайдене замовлення CRM</summary>
      <p>Знайдіть замовлення в KeyCRM та звірте час, товари, кількість і ціни. Автоматична перевірка зіставить його з цією спробою.</p>
      <label>CRM-ID<input inputMode="numeric" pattern="[1-9][0-9]*" value={crmId} onChange={(event) => setCrmId(event.target.value)} /></label>
      <label className="keycrm-checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Я перевірив, що це замовлення створене саме з цього чека.</label>
      <button type="button" className="keycrm-secondary" disabled={!enabled || busy || !confirmed || !/^[1-9]\d*$/.test(crmId)} onClick={() => onReconcile(crmId)}>
        {busy ? 'Перевіряємо…' : 'Перевірити та прив’язати CRM-ID'}
      </button>
    </details>}
  </div>;
}
