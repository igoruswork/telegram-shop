// The planned company-wide structure, built on top of the current document:
// a company block above the current head, six more top-manager slots, and the
// warehouse branch under the first of them. Used for the local preview.
import { addTopLevel, addTree, buildIndex, isBlank, updateNode } from './model.js';

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

export function plannedStructure(doc) {
  const next = addTopLevel(doc);
  if (next === doc) return doc; // already has the top level
  const { root, children } = buildIndex(next);
  const manager = children.get(root.id).find(isBlank);
  if (!manager) return next;
  return addTree(updateNode(next, manager.id, WAREHOUSE_MANAGER), manager.id, WAREHOUSE_DEPUTIES);
}
