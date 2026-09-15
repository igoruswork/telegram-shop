import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

function getCardStyle(color) {
  const value = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#B8A477';
  const channels = [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const dark = 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.062;
  return {
    '--payment-card-color': value,
    '--payment-card-rgb': channels.join(', '),
    '--payment-card-ink': dark ? '#ffffff' : '#0a1f2e',
    '--payment-card-ink-rgb': dark ? '255, 255, 255' : '10, 31, 46',
    '--payment-card-surface': dark ? 'rgba(0, 0, 0, .15)' : 'rgba(255, 255, 255, .5)',
  };
}

async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch { /* Older webviews can still support the selection fallback. */ }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(input);
  input.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy unavailable');
  } finally { input.remove(); }
}

function CopyIcon({ copied }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {copied ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" /></>}
  </svg>;
}

export function PaymentCard({ details, iban, color, taxId, extraDetails, visibility, expanded = false, onToggle, onHeightChange, preview = false }) {
  const cardRef = useRef(null);
  const timerRef = useRef(null);
  const [copyStatus, setCopyStatus] = useState('');
  const cardStyle = useMemo(() => getCardStyle(color), [color]);
  const showName = visibility?.name !== false && Boolean(details?.trim());
  const showIban = visibility?.iban !== false && Boolean(iban?.trim());
  const showTaxId = visibility?.taxId !== false && Boolean(taxId?.trim());
  const showExtra = visibility?.extraDetails !== false && Boolean(extraDetails?.trim());
  const title = showName ? details : 'Реквізити для оплати';
  const account = String(iban || '').replace(/\s+/g, '');
  const shortAccount = account.length > 12 ? `${account.slice(0, 4)} ···· ${account.slice(-4)}` : account;
  const copied = copyStatus === 'copied';

  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  useLayoutEffect(() => {
    if (!onHeightChange || !expanded || !cardRef.current) return;
    const measure = () => onHeightChange(Math.ceil(cardRef.current.getBoundingClientRect().height) + 12);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [expanded, onHeightChange]);

  async function handleCopy() {
    if (!showIban) return;
    window.clearTimeout(timerRef.current);
    try { await copyToClipboard(account); setCopyStatus('copied'); }
    catch { setCopyStatus('error'); if (!expanded) onToggle?.(); }
    timerRef.current = window.setTimeout(() => setCopyStatus(''), 2400);
  }

  return <aside ref={cardRef} className={`payment-card payment-card--aurora ${expanded ? 'payment-card--expanded' : ''} ${preview ? 'payment-card--preview' : ''}`} style={cardStyle} aria-label="Реквізити для оплати">
    <div className="payment-card-art" aria-hidden="true"><i /><i /><i /></div>
    <button type="button" className="payment-card-open" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? 'Згорнути реквізити' : 'Відкрити реквізити'}>
      <span className="payment-card-topline"><span><i aria-hidden="true" /> ДЛЯ ОПЛАТИ</span><svg className="payment-card-symbol" viewBox="0 0 32 20" fill="none" aria-hidden="true"><path d="M1 15C8 2 17 1 31 6" /><path d="M5 19C12 8 21 6 31 10" /></svg></span>
      <span className="payment-card-title">{title}</span>
      {!expanded && <span className="payment-card-account">{showIban ? shortAccount : 'Уся інформація тут'}</span>}
      {expanded && <span className="payment-card-close" aria-hidden="true">×</span>}
    </button>
    {!expanded && showIban && <button type="button" className={`payment-card-copy ${copied ? 'is-copied' : ''}`} onClick={handleCopy} aria-label={copied ? 'IBAN скопійовано' : 'Скопіювати IBAN'} title={copied ? 'Скопійовано' : 'Скопіювати IBAN'}><CopyIcon copied={copied} /></button>}
    {expanded && <div className="payment-card-body">
      {showIban && <div className="payment-card-account-panel"><span className="payment-card-label">БАНКІВСЬКИЙ РАХУНОК · IBAN</span><strong>{account.match(/.{1,4}/g)?.join(' ')}</strong><button type="button" className={`payment-card-copy-full ${copied ? 'is-copied' : ''}`} onClick={handleCopy}><CopyIcon copied={copied} />{copied ? 'IBAN скопійовано' : 'Скопіювати IBAN'}</button></div>}
      {showTaxId && <div className="payment-card-detail"><span>ІПН / ЄДРПОУ</span><strong>{taxId}</strong></div>}
      {showExtra && <div className="payment-card-detail payment-card-detail--extra"><span>Додатково</span><strong>{extraDetails}</strong></div>}
      {!showIban && !showTaxId && !showExtra && <p className="payment-card-empty">{showName ? 'Уточніть деталі оплати у менеджера.' : 'Реквізити ще не додано.'}</p>}
    </div>}
    <span className={`payment-card-feedback ${copyStatus === 'error' ? 'has-error' : ''}`} role="status">{copyStatus === 'error' ? 'Не вдалося скопіювати. Відкрийте реквізити й виділіть IBAN.' : copied ? 'IBAN скопійовано' : ''}</span>
  </aside>;
}
