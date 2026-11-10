import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  dutyLines,
  getDescendantIds,
  moveSibling,
  normalizeDoc,
  normalizePhone,
  removeNode,
  telegramHandle,
  updateNode,
} from '../src/company/model.js';
import { fillMerges, rowsToDoc } from '../src/company/importRows.js';

function sample() {
  return normalizeDoc({
    title: 'T',
    nodes: [
      { id: 'root', type: 'person', name: 'CEO' },
      { id: 'u1', parentId: 'root', type: 'unit', title: 'Unit' },
      { id: 'a', parentId: 'u1', name: 'A' },
      { id: 'b', parentId: 'u1', name: 'B' },
      { id: 'a1', parentId: 'a', name: 'A1' },
    ],
  });
}

test('normalizeDoc repairs dangling parents, duplicates, cycles and extra roots', () => {
  const doc = normalizeDoc({
    nodes: [
      { id: 'r', name: 'Root' },
      { id: 'x', parentId: 'missing' },
      { id: 'c1', parentId: 'c2' },
      { id: 'c2', parentId: 'c1' },
      { id: 'r', name: 'duplicate' },
    ],
  });
  assert.equal(doc.nodes.length, 4);
  assert.equal(doc.nodes.filter((n) => !n.parentId).length, 1);
  assert.equal(doc.nodes.find((n) => n.id === 'r').name, 'Root');
});

test('addNode appends after existing siblings', () => {
  const doc = addNode(sample(), { id: 'c', parentId: 'u1', name: 'C' });
  const siblings = doc.nodes.filter((n) => n.parentId === 'u1').map((n) => n.id);
  assert.deepEqual(siblings, ['a', 'b', 'c']);
});

test('updateNode refuses to move a node under its own descendant', () => {
  const doc = updateNode(sample(), 'a', { parentId: 'a1', name: 'A2' });
  const a = doc.nodes.find((n) => n.id === 'a');
  assert.equal(a.parentId, 'u1');
  assert.equal(a.name, 'A2');
});

test('updateNode moves a node to another parent', () => {
  const doc = updateNode(sample(), 'b', { parentId: 'a' });
  assert.equal(doc.nodes.find((n) => n.id === 'b').parentId, 'a');
  assert.deepEqual([...getDescendantIds(doc, 'a')].sort(), ['a1', 'b']);
});

test('removeNode reassigns children or cascades', () => {
  const reassigned = removeNode(sample(), 'a', 'reassign');
  assert.equal(reassigned.nodes.find((n) => n.id === 'a1').parentId, 'u1');
  assert.deepEqual(reassigned.nodes.filter((n) => n.parentId === 'u1').map((n) => n.id), ['a1', 'b']);

  const cascaded = removeNode(sample(), 'u1', 'cascade');
  assert.deepEqual(cascaded.nodes.map((n) => n.id), ['root']);
});

test('moveSibling swaps order within the same parent only', () => {
  const doc = moveSibling(sample(), 'b', -1);
  assert.deepEqual(doc.nodes.filter((n) => n.parentId === 'u1').map((n) => n.id), ['b', 'a']);
  assert.equal(moveSibling(doc, 'b', -1), doc);
});

test('phone, telegram and duties helpers', () => {
  assert.equal(normalizePhone(380930965196), '+380930965196');
  assert.equal(normalizePhone('0 63 793 07 61'), '+380637930761');
  assert.equal(normalizePhone(80935427598), '+380935427598');
  assert.equal(telegramHandle('@JuliaButsyk'), 'JuliaButsyk');
  assert.equal(telegramHandle('https://t.me/some_user'), 'some_user');
  const lines = dutyLines('"Звертатись з питань:\n- перше;\n• друге\n- ро"');
  assert.deepEqual(lines.map((l) => l.text), ['Звертатись з питань:', 'перше', 'друге']);
  assert.equal(lines[0].heading, true);
});

test('rowsToDoc builds the hierarchy from the contacts sheet layout', () => {
  const header = [' ', '', 'ПІБ', 'Посада', 'Бренд', 'Телеграм ', 'Телефон', 'Пошта'];
  const rows = [
    header,
    ['', 1, 'Boss', 'CMO', 'all', '@boss', 380930000000, 'b@x.ua', 'strategy'],
    ['', 2, 'Direct', 'Trade', 'all', 'direct', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['Digital Unit', 3, 'Lead', 'Head of Digital', 'all', '@lead', '', '', 'shared duties'],
    ['', 4, 'Member', 'Marketer', 'all', '@m', '', '', ''],
    ['Designers', 5, 'Designer', 'Graphic designer', 'all', '@d', '', '', ''],
  ];
  const merges = [{ s: { r: 4, c: 8 }, e: { r: 5, c: 8 } }];
  const doc = rowsToDoc(rows, { merges });
  const byName = Object.fromEntries(doc.nodes.map((n) => [n.name || n.title, n]));

  assert.equal(byName.Boss.parentId, null);
  assert.equal(byName.Direct.parentId, byName.Boss.id);
  assert.equal(byName.Direct.telegram, '@direct');
  assert.equal(byName['Digital Unit'].type, 'unit');
  assert.equal(byName['Digital Unit'].parentId, byName.Boss.id);
  assert.equal(byName.Lead.parentId, byName['Digital Unit'].id);
  assert.equal(byName.Member.parentId, byName.Lead.id);
  assert.equal(byName.Member.duties, 'shared duties');
  assert.equal(byName.Designer.parentId, byName.Designers.id);
  assert.equal(byName.Boss.phone, '+380930000000');
});

test('fillMerges never copies unit names down column A', () => {
  const rows = fillMerges([['Unit', 'x'], ['', '']], [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }]);
  assert.equal(rows[1][0], '');
});
