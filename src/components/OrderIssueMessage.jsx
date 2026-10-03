import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { useKeyCrmRecord } from './KeyCrmOrders';
import { copyFormattedToClipboard, copyToClipboard } from '../lib/clipboard';
import {
  DEFAULT_ORDER_ISSUE_TEMPLATE, ORDER_ISSUE_FIELDS, ORDER_ISSUE_TEMPLATE_LIMIT,
  formatOrderIssueText, normalizeOrderIssueTemplate, orderIssueMessage, validateOrderIssueTemplate,
} from '../lib/orderIssueTemplate';
import './OrderIssueMessage.css';

const IssueContext = createContext(null);

export function OrderIssueMessages({ template, onSave, children }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const textarea = useRef(null);
  const titleId = useId();
  const savedTemplate = normalizeOrderIssueTemplate(template);

  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);

  function edit() {
    setDraft(savedTemplate);
    setError('');
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const problem = validateOrderIssueTemplate(draft);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      setError('Не вдалося зберегти шаблон. Текст залишився в редакторі; спробуйте ще раз.');
    } finally { setSaving(false); }
  }

  function insert(field) {
    const input = textarea.current;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const token = `{{${field}}}`;
    setDraft((value) => value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return <IssueContext.Provider value={{ template: savedTemplate, edit }}>
    {children}
    <dialog ref={dialog} className="order-issue-dialog" aria-labelledby={titleId}
      onCancel={(event) => { if (saving) event.preventDefault(); else setEditing(false); }}>
      <form onSubmit={save}>
        <h2 id={titleId}>Шаблон видачі замовлень</h2>
        <p>Спільний для всіх чеків і пристроїв. Сума та номер CRM підставляються окремо для кожного замовлення. Перший рядок копіюється жирним, IBAN — моноширинним.</p>
        <label htmlFor={`${titleId}-text`}>Текст повідомлення</label>
        <textarea ref={textarea} id={`${titleId}-text`} value={draft} rows={14} maxLength={ORDER_ISSUE_TEMPLATE_LIMIT}
          disabled={saving} onChange={(event) => setDraft(event.target.value)} />
        <div className="order-issue-fields" aria-label="Вставити поле">
          {ORDER_ISSUE_FIELDS.map((field) => <button key={field} type="button" className="keycrm-secondary"
            disabled={saving} onClick={() => insert(field)}>{`{{${field}}}`}</button>)}
        </div>
        {error && <p role="alert" className="keycrm-warning">{error}</p>}
        <div className="order-issue-editor-actions">
          <button type="button" className="order-issue-edit" disabled={saving} onClick={() => setDraft(DEFAULT_ORDER_ISSUE_TEMPLATE)}>Початковий шаблон</button>
          <button type="button" className="keycrm-secondary" disabled={saving} onClick={() => setEditing(false)}>Скасувати</button>
          <button type="submit" className="keycrm-primary" disabled={saving}>{saving ? 'Зберігаємо…' : 'Зберегти шаблон'}</button>
        </div>
      </form>
    </dialog>
  </IssueContext.Provider>;
}

export function OrderIssueMessage({ orderId, receiptTotal }) {
  const { template, edit } = useContext(IssueContext);
  const record = useKeyCrmRecord(orderId);
  const { text, ready } = orderIssueMessage(template, receiptTotal, record);
  const formatted = formatOrderIssueText(text);
  const [copyStatus, setCopyStatus] = useState('');
  const timer = useRef(null);
  useEffect(() => { setCopyStatus(''); }, [text]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    if (!ready) return;
    window.clearTimeout(timer.current);
    try {
      const mode = await copyFormattedToClipboard(formatted);
      setCopyStatus(mode === 'rich' ? 'copied' : 'markup');
    }
    catch { setCopyStatus('error'); }
    timer.current = window.setTimeout(() => setCopyStatus(''), 3000);
  }

  async function copyIban(iban) {
    window.clearTimeout(timer.current);
    try { await copyToClipboard(iban); setCopyStatus('iban'); }
    catch { setCopyStatus('error'); }
    timer.current = window.setTimeout(() => setCopyStatus(''), 3000);
  }

  return <aside className="order-issue-message" aria-label={`Текст видачі для чека ${orderId}`}>
    <div className="order-issue-heading">
      <span>Повідомлення покупцеві</span>
      <button type="button" className="order-issue-edit" onClick={edit}>Редагувати шаблон</button>
    </div>
    <div className="order-issue-preview">{formatted.lines.map((parts, index) => {
      const content = parts.map((part, partIndex) => part.iban
        ? <button key={partIndex} type="button" className="order-issue-iban" onClick={() => copyIban(part.text)}
          aria-label={`Скопіювати IBAN ${part.text}`} title="Скопіювати IBAN"><code>{part.text}</code></button>
        : part.text);
      const line = parts.some((part) => part.text) ? content : '\u00a0';
      return index === 0 ? <strong key={index}>{line}</strong> : <div key={index}>{line}</div>;
    })}</div>
    <button type="button" className="keycrm-primary order-issue-copy" onClick={copy} disabled={!ready}>
      {['copied', 'markup'].includes(copyStatus) ? '✓ Скопійовано' : 'Копіювати весь текст'}
    </button>
    {!ready && <p className="order-issue-note">Копіювання всього тексту стане доступним після підтвердженого створення в CRM. До цього призначення не заповнене.</p>}
    <span role="status" className={copyStatus === 'error' ? 'keycrm-warning' : 'order-issue-feedback'}>
      {copyStatus === 'error' ? 'Не вдалося скопіювати. Виділіть текст повідомлення та скопіюйте вручну.'
        : copyStatus === 'iban' ? 'IBAN скопійовано'
          : copyStatus === 'copied' ? 'Увесь текст скопійовано з форматуванням'
            : copyStatus === 'markup' ? 'Скопійовано з розміткою для Telegram' : ''}
    </span>
  </aside>;
}
