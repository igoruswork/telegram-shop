// The planned company-wide structure, built on top of the current document:
// a company block above the current head, six more top-manager slots, and the
// warehouse branch under the first of them. /company/?top on the dev server
// previews whatever is not in the live data yet.
import { addTopLevel, addTree, buildIndex, emptyNode, insertAbove, isBlank, updateNode } from './model.js';

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

/** Every step is skipped once it is already in the document. */
export function plannedStructure(doc) {
  return withBirthdays(withWarehouseUnits(withTopLevel(doc)));
}
