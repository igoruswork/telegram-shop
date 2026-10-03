import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ORDER_ISSUE_TEMPLATE, normalizeOrderIssueTemplate, orderIssueMessage, validateOrderIssueTemplate } from '../src/lib/orderIssueTemplate.js';

test('issue message keeps both actual totals and the confirmed CRM ID distinct', () => {
  const result = orderIssueMessage(DEFAULT_ORDER_ISSUE_TEMPLATE, 64, { state: 'created', crm_id: 207612, crm_total: 128 });
  assert.equal(result.ready, true);
  assert.match(result.text, /64 : сума чека\n128 : сума CRM\n207612 : призначення/);
  assert.match(result.text, /🫆UA903052990000026005025017139/);
  assert.match(result.text, /ТИЩЕНКО В.О.\nІПН\/ЄДРПОУ 2143302639$/);
  assert.doesNotMatch(result.text, /\{\{/);
});

test('unknown or rejected CRM results never become a copyable payment message', () => {
  for (const state of [undefined, 'preflight', 'posting', 'failed', 'needs_review']) {
    const result = orderIssueMessage(DEFAULT_ORDER_ISSUE_TEMPLATE, 64, { state, crm_id: 207612, crm_total: 128 });
    assert.equal(result.ready, false);
    assert.match(result.text, /— : сума CRM\n— : призначення/);
  }
  for (const patch of [{ crm_id: 0 }, { crm_id: 'oops' }, { crm_total: null }, { crm_total: -1 }]) {
    assert.equal(orderIssueMessage(DEFAULT_ORDER_ISSUE_TEMPLATE, 64, { state: 'created', crm_id: 207612, crm_total: 64, ...patch }).ready, false);
  }
});

test('template edits preserve all three automatic fields and reject typos', () => {
  assert.equal(validateOrderIssueTemplate(DEFAULT_ORDER_ISSUE_TEMPLATE), '');
  assert.match(validateOrderIssueTemplate(''), /Введіть/);
  assert.match(validateOrderIssueTemplate(DEFAULT_ORDER_ISSUE_TEMPLATE.replace('{{сума_CRM}}', '64')), /Залиште поле/);
  assert.match(validateOrderIssueTemplate(DEFAULT_ORDER_ISSUE_TEMPLATE + '{{номер}}'), /Невідоме поле/);
  assert.match(validateOrderIssueTemplate('x'.repeat(4001)), /4000/);
  assert.equal(normalizeOrderIssueTemplate(null), DEFAULT_ORDER_ISSUE_TEMPLATE);
});

test('formatted amounts, zero totals, repeated fields and literal text copy correctly', () => {
  const template = '{{сума_чека}}\n{{сума_CRM}}\n{{номер_CRM}} / {{номер_CRM}}\n<script>literal</script>';
  const result = orderIssueMessage(template, 1234.5, { state: 'created', crm_id: 207612, crm_total: 0 });
  assert.equal(result.ready, true);
  assert.equal(result.text, '1\u00a0234,5\n0\n207612 / 207612\n<script>literal</script>');
  assert.equal(orderIssueMessage(template, null, { state: 'created', crm_id: 1, crm_total: 0 }).ready, false);
});
