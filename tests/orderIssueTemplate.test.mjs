import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ORDER_ISSUE_TEMPLATE, formatOrderIssueText, normalizeOrderIssueTemplate, orderIssueMessage, validateOrderIssueTemplate } from '../src/lib/orderIssueTemplate.js';

test('issue message shows only the receipt amount and confirmed CRM ID', () => {
  const result = orderIssueMessage(DEFAULT_ORDER_ISSUE_TEMPLATE, 64, { state: 'created', crm_id: 207612, crm_total: 128 });
  assert.equal(result.ready, true);
  assert.match(result.text, /64 : сума\n207612 : призначення/);
  assert.doesNotMatch(result.text, /сума чека|сума CRM|128/);
  assert.match(result.text, /🫆UA903052990000026005025017139/);
  assert.match(result.text, /ТИЩЕНКО В.О.\nІПН\/ЄДРПОУ 2143302639$/);
  assert.doesNotMatch(result.text, /\{\{/);
});

test('unknown or rejected CRM results never become a copyable payment message', () => {
  for (const state of [undefined, 'preflight', 'posting', 'failed', 'needs_review']) {
    const result = orderIssueMessage(DEFAULT_ORDER_ISSUE_TEMPLATE, 64, { state, crm_id: 207612, crm_total: 128 });
    assert.equal(result.ready, false);
    assert.match(result.text, /64 : сума\n— : призначення/);
  }
  for (const patch of [{ crm_id: 0 }, { crm_id: 'oops' }, { crm_total: null }, { crm_total: -1 }]) {
    assert.equal(orderIssueMessage(DEFAULT_ORDER_ISSUE_TEMPLATE, 64, { state: 'created', crm_id: 207612, crm_total: 64, ...patch }).ready, false);
  }
});

test('template edits require only amount and CRM ID, rejecting retired/unknown fields', () => {
  assert.equal(validateOrderIssueTemplate(DEFAULT_ORDER_ISSUE_TEMPLATE), '');
  assert.match(validateOrderIssueTemplate(''), /Введіть/);
  assert.match(validateOrderIssueTemplate(DEFAULT_ORDER_ISSUE_TEMPLATE.replace('{{сума_чека}}', '64')), /Залиште поле/);
  assert.match(validateOrderIssueTemplate(DEFAULT_ORDER_ISSUE_TEMPLATE + '{{сума_CRM}}'), /Невідоме поле/);
  assert.match(validateOrderIssueTemplate(DEFAULT_ORDER_ISSUE_TEMPLATE + '{{номер}}'), /Невідоме поле/);
  assert.match(validateOrderIssueTemplate('x'.repeat(4001)), /4000/);
  assert.equal(normalizeOrderIssueTemplate(null), DEFAULT_ORDER_ISSUE_TEMPLATE);
});

test('formatted amounts, zero totals, repeated fields and literal text copy correctly', () => {
  const template = '{{сума_чека}}\n{{номер_CRM}} / {{номер_CRM}}\n<script>literal</script>';
  const result = orderIssueMessage(template, 1234.5, { state: 'created', crm_id: 207612, crm_total: 0 });
  assert.equal(result.ready, true);
  assert.equal(result.text, '1\u00a0234,5\n207612 / 207612\n<script>literal</script>');
  assert.equal(orderIssueMessage(template, null, { state: 'created', crm_id: 1, crm_total: 0 }).ready, false);
});

test('previously saved templates migrate without losing custom hours or bank details', () => {
  const old = 'Видача замовлень\r\nз 17:00 до 19:00\r\n{{сума_чека}} : сума чека\r\n{{сума_CRM}} : сума CRM\r\n{{номер_CRM}} : призначення\r\nМій отримувач';
  const migrated = normalizeOrderIssueTemplate(old);
  assert.equal(migrated, 'Видача замовлень\nз 17:00 до 19:00\n{{сума_чека}} : сума\n{{номер_CRM}} : призначення\nМій отримувач');
  assert.equal(normalizeOrderIssueTemplate(migrated), migrated);
  assert.equal(validateOrderIssueTemplate(migrated), '');
  assert.equal(normalizeOrderIssueTemplate('{{сума_чека}} : сума чека; {{сума_CRM}} : сума CRM\n{{номер_CRM}}'), '{{сума_чека}} : сума; \n{{номер_CRM}}');
});

test('Telegram copy carries a bold title and code IBAN without turning template text into HTML', () => {
  const { text } = orderIssueMessage(DEFAULT_ORDER_ISSUE_TEMPLATE, 64, { state: 'created', crm_id: 207612, crm_total: 128 });
  const formatted = formatOrderIssueText(text + '\n<script>alert("test")</script>&');
  assert.match(formatted.html, /<b>Видача замовлень<\/b>/);
  assert.match(formatted.html, /🫆<code style="font-family:monospace">UA903052990000026005025017139<\/code>/);
  assert.match(formatted.html, /&lt;script&gt;alert\(&quot;test&quot;\)&lt;\/script&gt;&amp;/);
  assert.doesNotMatch(formatted.html, /<script>/);
  assert.match(formatted.telegramText, /^\*\*Видача замовлень\*\*/);
  assert.ok(formatted.telegramText.includes('🫆`UA903052990000026005025017139`'));
  assert.equal(formatted.lines.flat().filter((part) => part.iban).length, 1);
});
