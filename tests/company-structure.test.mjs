import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  addTopLevel,
  buildIndex,
  countPeople,
  formatBirthday,
  insertAbove,
  isBirthdayToday,
  isBlank,
  isGroup,
  displayName,
  totalPeople,
  formatHired,
  normalizeHired,
  workAnniversary,
  normalizeBirthday,
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
import { plannedStructure } from '../src/company/planned.js';

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

test('safePhoto keeps small inline images and https links only', async () => {
  const { safePhoto, normalizeNode } = await import('../src/company/model.js');
  assert.equal(safePhoto('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
  assert.equal(safePhoto('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(safePhoto('javascript:alert(1)'), '');
  assert.equal(safePhoto('data:image/svg+xml;base64,AAAA'), '');
  assert.equal(safePhoto(`data:image/png;base64,${'A'.repeat(70000)}`), '');
  assert.equal(normalizeNode({ id: 'x', photo: 'http://insecure/a.jpg' }).photo, '');
});

test('blank cards are placeholders and are not counted as people', () => {
  const doc = normalizeDoc({ nodes: [
    { id: 'u', type: 'unit', title: 'Unit' },
    { id: 'a', parentId: 'u', name: 'Ann' },
    { id: 'b', parentId: 'u' },
    { id: 'c', parentId: 'u', title: 'Designer' },
  ] });
  assert.equal(isBlank(doc.nodes[2]), true);
  assert.equal(isBlank(doc.nodes[3]), true);
  assert.equal(countPeople(doc, 'u'), 1);
});

test('insertAbove puts a new card between a node and its parent', () => {
  const doc = normalizeDoc({ nodes: [{ id: 'r', name: 'Root' }, { id: 'k', parentId: 'r', name: 'Kid' }] });
  const next = insertAbove(doc, 'r', { id: 'top', type: 'unit', title: 'Owners' });
  const { root, byId } = buildIndex(next);
  assert.equal(root.id, 'top');
  assert.equal(byId.get('r').parentId, 'top');
  assert.equal(byId.get('k').parentId, 'r');
  assert.deepEqual(normalizeDoc(next).nodes.map((n) => n.parentId), next.nodes.map((n) => n.parentId));
});

test('addTopLevel puts a company unit above the root with blank top managers, once', () => {
  const doc = normalizeDoc({ subtitle: 'ProCare', nodes: [{ id: 'r', name: 'CMO' }, { id: 'k', parentId: 'r', name: 'Kid' }] });
  const next = addTopLevel(doc);
  const { root, children } = buildIndex(next);
  const kids = children.get(root.id);
  assert.equal(root.type, 'unit');
  assert.equal(root.title, 'ProCare');
  assert.equal(kids.length, 7);
  assert.equal(kids[0].id, 'r');
  assert.equal(kids.filter((n) => n.head).length, 0);
  assert.deepEqual(kids.slice(1).map((n) => [isBlank(n), n.title]), Array(6).fill([true, 'Топ-менеджер']));
  assert.equal(countPeople(next, root.id), 2);
  assert.equal(addTopLevel(next), next);

  const withOwners = buildIndex(addTopLevel(doc, { owners: 3 }));
  assert.equal(withOwners.children.get(withOwners.root.id).filter((n) => n.head).length, 3);
});

test('plannedStructure adds the warehouse branch and the rest of the office', () => {
  const doc = normalizeDoc({ nodes: [{ id: 'r', name: 'CMO' }] });
  const next = plannedStructure(doc);
  const { root, children } = buildIndex(next);
  const top = children.get(root.id);
  assert.deepEqual([top[0].name, top[0].head, top[1].name], ['Каган Олександр', true, 'CMO']);
  assert.equal(top.some(isBlank), false);
  const manager = top.find((n) => n.name === 'Сергій Моторний');
  assert.equal(manager.title, 'Завідувач складом готової продукції');
  const units = children.get(manager.id);
  assert.deepEqual(units.map((n) => [n.type, n.title]), [['unit', 'Роздрібний склад'], ['unit', 'Гуртовий склад']]);
  const deputies = units.map((unit) => children.get(unit.id)[0]);
  assert.deepEqual(deputies.map((n) => n.name), ['Ігор Яблонський', 'Світлана Шевченко']);
  assert.deepEqual(children.get(deputies[0].id).map((n) => n.name), ['Людмила', 'Наталія', 'Надія', 'Дмитро', 'Каріна']);
  assert.deepEqual(
    children.get(deputies[1].id).map((n) => [n.title, n.count]),
    [['Комірник', 19], ["Кур'єр", 1], ['Оператор', 2], ['Водій', 3], ['Прибиральниця', 1]],
  );
  assert.equal(countPeople(next, manager.id), 2 + 5 + 26);
  const names = next.nodes.filter((n) => n.type === 'person' && n.name).map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  const byName = new Map(next.nodes.map((n) => [n.name, n]));
  assert.deepEqual([byName.get('Каган Олександр').birthday, byName.get('Каган Олександр').large], ['16.11', true]);
  assert.deepEqual([byName.get('Халипа Олена').birthday, byName.get('Халипа Олена').large], ['18.07', true]);
  assert.deepEqual([byName.get('Сергій Моторний').birthday, byName.get('Сергій Моторний').hired], ['20.04', '01.12.2018']);
  assert.equal(plannedStructure(next), next);
});

test('hire date is a full date and marks work anniversaries', () => {
  assert.equal(normalizeHired('28.8.2024'), '28.08.2024');
  assert.equal(normalizeHired('2024-08-28'), '28.08.2024');
  assert.equal(normalizeHired('31.02.2024'), '');
  assert.equal(normalizeHired('28.08'), '');
  assert.equal(formatHired('28.08.2024'), '28 серпня 2024');
  const person = normalizeDoc({ nodes: [{ name: 'A', hired: '10.11.2022', large: true }] }).nodes[0];
  assert.equal(person.large, true);
  assert.equal(workAnniversary(person, new Date(2026, 10, 10)), 4);
  assert.equal(workAnniversary(person, new Date(2026, 10, 11)), 0);
  assert.equal(workAnniversary(person, new Date(2022, 10, 10)), 0);
  assert.equal(workAnniversary({ type: 'person', hired: '29.02.2024' }, new Date(2026, 1, 28)), 2);
  assert.equal(normalizeDoc({ nodes: [{ type: 'unit', title: 'U', hired: '10.11.2022', large: true }] }).nodes[0].large, false);
});

test('a shared card stands for several people in one role', () => {
  const doc = normalizeDoc({
    nodes: [
      { id: 'u', type: 'unit', title: 'Склад' },
      { id: 'a', parentId: 'u', name: 'Anna' },
      { id: 'g', parentId: 'u', title: 'Комірник', count: '19' },
      { id: 'b', parentId: 'u' },
      { id: 'x', parentId: 'u', type: 'unit', title: 'X', count: 5 },
    ],
  });
  const group = doc.nodes[2];
  assert.equal(group.count, 19);
  assert.equal(isGroup(group), true);
  assert.equal(isBlank(group), false);
  assert.equal(displayName(group), 'Комірник');
  assert.equal(doc.nodes[4].count, 0);
  assert.equal(countPeople(doc, 'u'), 20);
  assert.equal(totalPeople(doc), 20);
  assert.equal(normalizeDoc({ nodes: [{ name: 'A', count: -3 }] }).nodes[0].count, 0);
});

test('birthday keeps day and month only and matches the current date', () => {
  assert.equal(normalizeBirthday('11.11.'), '11.11');
  assert.equal(normalizeBirthday(' 1/3 '), '01.03');
  assert.equal(normalizeBirthday('31.04'), '');
  assert.equal(normalizeBirthday('11.11.1990'), '');
  assert.equal(normalizeBirthday('hello'), '');
  assert.equal(formatBirthday('01.03'), '1 березня');

  const [nadia] = normalizeDoc({ nodes: [{ id: 'a', name: 'Надія', birthday: '11.11.' }] }).nodes;
  assert.equal(nadia.birthday, '11.11');
  assert.equal(isBirthdayToday(nadia, new Date(2026, 10, 11)), true);
  assert.equal(isBirthdayToday(nadia, new Date(2026, 10, 12)), false);
  assert.equal(isBirthdayToday({ type: 'unit', birthday: '11.11' }, new Date(2026, 10, 11)), false);

  const leapDay = { type: 'person', birthday: '29.02' };
  assert.equal(isBirthdayToday(leapDay, new Date(2027, 1, 28)), true);
  assert.equal(isBirthdayToday(leapDay, new Date(2028, 1, 28)), false);
  assert.equal(isBirthdayToday(leapDay, new Date(2028, 1, 29)), true);
});

test('plannedStructure sets the test birthday without overwriting an existing one', () => {
  const doc = normalizeDoc({ nodes: [{ id: 'r', name: 'CMO' }] });
  const next = plannedStructure(doc);
  assert.equal(next.nodes.find((n) => n.name === 'Надія').birthday, '11.11');
  const edited = normalizeDoc({ ...next, nodes: next.nodes.map((n) => (n.name === 'Надія' ? { ...n, birthday: '05.06' } : n)) });
  assert.equal(plannedStructure(edited), edited);
});
