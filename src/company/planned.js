// The planned company-wide structure, built on top of the current document:
// a company block above the current head, six more top-manager slots, and the
// warehouse branch under the first of them. /company/?top on the dev server
// previews whatever is not in the live data yet.
import { addTopLevel, addTree, buildIndex, emptyNode, insertAbove, isBlank, isGroup, removeNode, updateNode } from './model.js';
import { OFFICE_CEO, OFFICE_TOP, WAREHOUSE_STAFF } from './office2026.js';
import { LARGE_CARDS, OFFICE_DATES } from './officeDates.js';

const blanks = (count) => Array.from({ length: count }, () => ({}));

const WAREHOUSE_MANAGER = { name: 'Сергій Моторний', title: 'Завідувач складом готової продукції' };

const WAREHOUSE_DEPUTIES = [
  {
    name: 'Ігор Яблонський',
    title: 'Head of CRM · роздрібний склад',
    children: ['Людмила', 'Наталія', 'Надія', 'Дмитро', 'Каріна'].map((name) => ({ name })),
  },
  {
    name: 'Світлана Шевченко',
    title: 'Заступник · гуртовий склад',
    children: blanks(18),
  },
];

// A unit block above each warehouse deputy.
const WAREHOUSE_UNITS = [
  { person: 'Ігор Яблонський', title: 'Роздрібний склад', color: '#10b981' },
  { person: 'Світлана Шевченко', title: 'Гуртовий склад', color: '#6366f1' },
];

function withTopLevel(doc) {
  const next = addTopLevel(doc);
  if (next === doc) return doc; // already has the top level
  const { root, children } = buildIndex(next);
  const manager = children.get(root.id).find(isBlank);
  if (!manager) return next;
  return addTree(updateNode(next, manager.id, WAREHOUSE_MANAGER), manager.id, WAREHOUSE_DEPUTIES);
}

function withWarehouseUnits(doc) {
  let next = doc;
  for (const { person, title, color } of WAREHOUSE_UNITS) {
    const { byId } = buildIndex(next);
    const target = next.nodes.find((n) => n.type === 'person' && n.name === person);
    const parent = target && byId.get(target.parentId);
    if (!target || (parent?.type === 'unit' && parent.title === title)) continue;
    next = insertAbove(next, target.id, emptyNode({ type: 'unit', title, color }));
  }
  return next;
}

const BIRTHDAYS = [{ person: 'Надія', birthday: '11.11' }];

function withBirthdays(doc) {
  let next = doc;
  for (const { person, birthday } of BIRTHDAYS) {
    const target = next.nodes.find((n) => n.type === 'person' && n.name === person);
    if (target && !target.birthday) next = updateNode(next, target.id, { birthday });
  }
  return next;
}

const childless = (index, node) => !(index.children.get(node.id) || []).length;

// Shared cards (Комірник — 19, …) take the place of the blank slots under the deputy.
function withWarehouseStaff(doc) {
  const deputy = doc.nodes.find((n) => n.type === 'person' && n.name === 'Світлана Шевченко');
  if (!deputy) return doc;
  const index = buildIndex(doc);
  const kids = index.children.get(deputy.id) || [];
  if (kids.some(isGroup)) return doc;
  let next = doc;
  for (const kid of kids) {
    if (isBlank(kid) && !kid.title && childless(index, kid)) next = removeNode(next, kid.id, 'cascade');
  }
  return addTree(next, deputy.id, WAREHOUSE_STAFF);
}

// The rest of the office from "Офіс ProCare 2026": the CEO as the head of the
// company block and every director's branch next to the existing ones.
// People already in the document are left exactly as they are.
function withOffice(doc) {
  const index = buildIndex(doc);
  const { root } = index;
  if (!root || root.type !== 'unit') return doc;
  if (doc.nodes.some((n) => n.type === 'person' && n.name === OFFICE_CEO.name)) return doc;
  let next = doc;
  for (const kid of index.children.get(root.id) || []) {
    if (isBlank(kid) && kid.title === 'Топ-менеджер' && childless(index, kid)) next = removeNode(next, kid.id, 'cascade');
  }
  // The head goes first among the root's children.
  const ceo = emptyNode({ ...OFFICE_CEO, parentId: root.id, head: true });
  const nodes = [...next.nodes];
  nodes.splice(nodes.findIndex((n) => n.parentId === root.id), 0, ceo);
  return addTree({ ...next, nodes }, root.id, OFFICE_TOP);
}

// Fills in what is still empty; dates and sizes already set by hand stay.
function withDates(doc) {
  const byName = new Map(doc.nodes.filter((n) => n.type === 'person' && n.name).map((n) => [n.name, n]));
  let next = doc;
  for (const [name, birthday, hired] of OFFICE_DATES) {
    const node = byName.get(name);
    if (!node) continue;
    const patch = {};
    if (birthday && !node.birthday) patch.birthday = birthday;
    if (hired && !node.hired) patch.hired = hired;
    if (Object.keys(patch).length) next = updateNode(next, node.id, patch);
  }
  // Only while the page has no large cards yet, so unticking one later sticks.
  if (!next.nodes.some((n) => n.large)) {
    for (const name of LARGE_CARDS) {
      const node = byName.get(name);
      if (node) next = updateNode(next, node.id, { large: true });
    }
  }
  return next;
}

/** Every step is skipped once it is already in the document. */
export function plannedStructure(doc) {
  return withDates(withOffice(withWarehouseStaff(withBirthdays(withWarehouseUnits(withTopLevel(doc))))));
}
