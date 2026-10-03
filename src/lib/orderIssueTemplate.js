export const DEFAULT_ORDER_ISSUE_TEMPLATE = `Видача замовлень
з 16:00 до 18:00
(оформлених до 15:00)
-               -               -
{{сума_чека}} : сума
{{номер_CRM}} : призначення
-               -               -
🫆UA903052990000026005025017139
-               -               -
ТИЩЕНКО В.О.
ІПН/ЄДРПОУ 2143302639`;

export const ORDER_ISSUE_FIELDS = ['сума_чека', 'номер_CRM'];
export const ORDER_ISSUE_TEMPLATE_LIMIT = 4000;

export function normalizeOrderIssueTemplate(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > ORDER_ISSUE_TEMPLATE_LIMIT) return DEFAULT_ORDER_ISSUE_TEMPLATE;
  // Upgrade previously saved templates without resetting edited hours/details.
  return value.split(/\r?\n/).flatMap((line) => {
    if (line.includes('{{сума_CRM}}')) {
      if (!ORDER_ISSUE_FIELDS.some((field) => line.includes(`{{${field}}}`))) return [];
      line = line.replace(/\{\{сума_CRM\}\}(?:\s*:\s*сума\s+CRM)?/giu, '');
    }
    return [line.replace(/(:\s*)сума чека/giu, '$1сума')];
  }).join('\n');
}

export function validateOrderIssueTemplate(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Введіть текст шаблону.';
  if (value.length > ORDER_ISSUE_TEMPLATE_LIMIT) return 'Шаблон має містити не більше 4000 символів.';
  for (const field of ORDER_ISSUE_FIELDS) {
    if (!value.includes(`{{${field}}}`)) return `Залиште поле {{${field}}}, щоб дані чека підставлялися автоматично.`;
  }
  for (const [, field] of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (!ORDER_ISSUE_FIELDS.includes(field)) return `Невідоме поле {{${field}}}. Скористайтеся полями під редактором.`;
  }
  return '';
}

function amount(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? number.toLocaleString('uk-UA', { maximumFractionDigits: 2 }) : null;
}

export function orderIssueMessage(template, receiptTotal, record) {
  const receipt = amount(receiptTotal);
  const crmTotal = record?.state === 'created' ? amount(record.crm_total) : null;
  const crmId = record?.state === 'created' && /^[1-9]\d*$/.test(String(record.crm_id))
    ? String(record.crm_id) : null;
  const values = { сума_чека: receipt ?? '—', номер_CRM: crmId ?? '—' };
  const text = normalizeOrderIssueTemplate(template).replace(/\{\{(сума_чека|номер_CRM)\}\}/g,
    (_token, field) => values[field]);
  return { text, ready: receipt !== null && crmTotal !== null && crmId !== null };
}

const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function formatOrderIssueText(text) {
  const lines = text.split('\n').map((line) => line.split(/(\bUA\d{27}\b)/g)
    .map((value) => ({ text: value, iban: /^UA\d{27}$/.test(value) })));
  const html = lines.map((parts, index) => {
    const content = parts.map((part) => part.iban
      ? `<code style="font-family:monospace">${part.text}</code>` : escapeHtml(part.text)).join('');
    return index === 0 ? `<b>${content}</b>` : content;
  }).join('<br>');
  const telegramText = lines.map((parts, index) => {
    const line = parts.map((part) => part.iban ? `\`${part.text}\`` : part.text).join('');
    return index === 0 ? `**${line}**` : line;
  }).join('\n');
  return { lines, html: `<div style="white-space:pre-wrap">${html}</div>`, telegramText };
}
