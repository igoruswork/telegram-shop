export const DEFAULT_ORDER_ISSUE_TEMPLATE = `Видача замовлень
з 16:00 до 18:00
(оформлених до 15:00)
-               -               -
{{сума_чека}} : сума чека
{{сума_CRM}} : сума CRM
{{номер_CRM}} : призначення
-               -               -
🫆UA903052990000026005025017139
-               -               -
ТИЩЕНКО В.О.
ІПН/ЄДРПОУ 2143302639`;

export const ORDER_ISSUE_FIELDS = ['сума_чека', 'сума_CRM', 'номер_CRM'];
export const ORDER_ISSUE_TEMPLATE_LIMIT = 4000;

export function normalizeOrderIssueTemplate(value) {
  return typeof value === 'string' && value.trim() && value.length <= ORDER_ISSUE_TEMPLATE_LIMIT
    ? value : DEFAULT_ORDER_ISSUE_TEMPLATE;
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
  const values = { сума_чека: receipt ?? '—', сума_CRM: crmTotal ?? '—', номер_CRM: crmId ?? '—' };
  const text = normalizeOrderIssueTemplate(template).replace(/\{\{(сума_чека|сума_CRM|номер_CRM)\}\}/g,
    (_token, field) => values[field]);
  return { text, ready: receipt !== null && crmTotal !== null && crmId !== null };
}
