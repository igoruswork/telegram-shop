// Pure helpers for the company structure document.
// Document shape:
// {
//   version: 1,
//   title: string,
//   subtitle: string,
//   nodes: Array<{
//     id, parentId (null for root), type: 'unit' | 'person',
//     title (position or unit name), name, brands, telegram, phone, email,
//     duties (multi-line text), color (units only, optional),
//     head (people only: shown inside the parent unit's block)
//   }>,
//   updatedAt: ISO string
// }
// Sibling order is the order of nodes in the array.

export const DOC_VERSION = 1;

export const UNIT_COLORS = [
  '#0ea5a4', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // pink
  '#10b981', // green
  '#6366f1', // indigo
  '#ef4444', // red
  '#64748b', // slate
];

export const ROOT_COLOR = '#0b8fbd';

let idCounter = 0;
export function createId(prefix = 'n') {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export function emptyNode(overrides = {}) {
  return {
    id: createId(overrides.type === 'unit' ? 'u' : 'p'),
    parentId: null,
    type: 'person',
    title: '',
    name: '',
    brands: '',
    telegram: '',
    phone: '',
    email: '',
    duties: '',
    color: '',
    photo: '',
    head: false,
    ...overrides,
  };
}

function cleanString(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

// Only small inline images or https links are accepted as avatars.
export const PHOTO_MAX_LENGTH = 60000;
export function safePhoto(value) {
  const photo = cleanString(value).trim();
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length <= PHOTO_MAX_LENGTH) return photo;
  if (/^https:\/\/[^\s"'<>]+$/.test(photo)) return photo;
  return '';
}

export function normalizeNode(raw) {
  const node = emptyNode();
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanString(source.id) || node.id,
    parentId: source.parentId ? cleanString(source.parentId) : null,
    type: source.type === 'unit' ? 'unit' : 'person',
    title: cleanString(source.title),
    name: cleanString(source.name),
    brands: cleanString(source.brands),
    telegram: cleanString(source.telegram),
    phone: cleanString(source.phone),
    email: cleanString(source.email),
    duties: cleanString(source.duties),
    color: cleanString(source.color),
    photo: safePhoto(source.photo),
    // Shown inside the parent unit's block (unit lead, co-owner).
    head: source.head === true && source.type !== 'unit',
  };
}

/**
 * Makes any (possibly hand-edited or remote) document safe to render:
 * unique ids, exactly one root, no dangling parents and no cycles.
 */
export function normalizeDoc(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const nodes = [];
  for (const item of Array.isArray(source.nodes) ? source.nodes : []) {
    const node = normalizeNode(item);
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push(node);
  }

  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    if (node.parentId && (!ids.has(node.parentId) || node.parentId === node.id)) node.parentId = null;
  }

  // Break cycles: walk up from every node; if we revisit, detach.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    const path = new Set([node.id]);
    let current = node;
    while (current.parentId) {
      if (path.has(current.parentId)) {
        current.parentId = null;
        break;
      }
      path.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }

  // Exactly one root: extra roots go under the first one.
  const roots = nodes.filter((n) => !n.parentId);
  if (roots.length > 1) {
    for (const extra of roots.slice(1)) extra.parentId = roots[0].id;
  }

  return {
    version: DOC_VERSION,
    title: cleanString(source.title) || 'Структура компанії',
    subtitle: cleanString(source.subtitle),
    nodes,
    updatedAt: cleanString(source.updatedAt) || new Date(0).toISOString(),
  };
}

export function getRoot(doc) {
  return doc.nodes.find((n) => !n.parentId) || null;
}

export function getChildren(doc, id) {
  return doc.nodes.filter((n) => n.parentId === id);
}

export function buildIndex(doc) {
  const byId = new Map();
  const children = new Map();
  for (const node of doc.nodes) {
    byId.set(node.id, node);
    if (!children.has(node.id)) children.set(node.id, []);
  }
  for (const node of doc.nodes) {
    if (node.parentId && children.has(node.parentId)) children.get(node.parentId).push(node);
  }
  return { byId, children, root: getRoot(doc) };
}

export function getDescendantIds(doc, id) {
  const { children } = buildIndex(doc);
  const result = new Set();
  const stack = [...(children.get(id) || [])];
  while (stack.length) {
    const node = stack.pop();
    if (result.has(node.id)) continue;
    result.add(node.id);
    stack.push(...(children.get(node.id) || []));
  }
  return result;
}

export function getAncestors(doc, id) {
  const { byId } = buildIndex(doc);
  const result = [];
  let current = byId.get(id);
  const guard = new Set();
  while (current?.parentId && !guard.has(current.parentId)) {
    guard.add(current.parentId);
    current = byId.get(current.parentId);
    if (current) result.unshift(current);
  }
  return result;
}

/** Nearest unit colour (the node's own colour for units). */
export function resolveColor(doc, id) {
  const { byId } = buildIndex(doc);
  let current = byId.get(id);
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    if (current.color) return current.color;
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return ROOT_COLOR;
}

// Readable text colour for content placed on a solid `color` fill.
// White stays the default; fills too light for it (amber, green…) get dark ink.
export function inkOn(color) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(cleanString(color).trim());
  if (!match) return '#ffffff';
  const hex = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05) >= 3 ? '#ffffff' : '#10202d';
}

/** A person card without a name yet: a placeholder slot (may carry a role). */
export function isBlank(node) {
  return node?.type === 'person' && !cleanString(node.name).trim();
}

export function displayName(node) {
  if (node.type === 'unit') return node.title || 'Без назви';
  return node.name || node.title || 'Порожня картка';
}

/** People below `id`; placeholder cards are not counted. */
export function countPeople(doc, id) {
  const ids = getDescendantIds(doc, id);
  return doc.nodes.filter((n) => ids.has(n.id) && n.type === 'person' && !isBlank(n)).length;
}

function touch(doc, nodes) {
  return { ...doc, nodes, updatedAt: new Date().toISOString() };
}

/** Inserts node as the last child of parentId (or root if doc empty). */
export function addNode(doc, node) {
  const clean = normalizeNode(node);
  if (!doc.nodes.length) clean.parentId = null;
  else if (!clean.parentId || !doc.nodes.some((n) => n.id === clean.parentId)) {
    clean.parentId = getRoot(doc)?.id || null;
  }
  // Insert after the last existing sibling so it shows up at the end.
  const nodes = [...doc.nodes];
  let insertAt = nodes.length;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (nodes[i].parentId === clean.parentId) {
      insertAt = i + 1;
      break;
    }
  }
  nodes.splice(insertAt, 0, clean);
  return touch(doc, nodes);
}

/** Inserts node between `id` and its parent, so `id` now reports to it. */
export function insertAbove(doc, id, node) {
  const target = doc.nodes.find((n) => n.id === id);
  if (!target) return doc;
  const clean = { ...normalizeNode(node), parentId: target.parentId, head: false };
  const nodes = [];
  for (const n of doc.nodes) {
    if (n.id === id) nodes.push(clean, { ...n, parentId: clean.id, head: false });
    else nodes.push(n);
  }
  return touch(doc, nodes);
}

/**
 * Puts a company unit above a single top manager and adds `managers` blank
 * top-manager cards next to them (plus `owners` blank cards inside the unit,
 * none by default). Does nothing if the root is already a unit.
 */
export function addTopLevel(doc, {
  managers = 6,
  owners = 0,
  title = '',
  managerTitle = 'Топ-менеджер',
  ownerTitle = 'Співвласник',
} = {}) {
  const root = getRoot(doc);
  if (!root || root.type === 'unit') return doc;
  const unit = emptyNode({ type: 'unit', title: title || doc.subtitle || 'Компанія', color: '#475569' });
  let next = insertAbove(doc, root.id, unit);
  if (owners > 0) {
    const nodes = [...next.nodes];
    const heads = Array.from({ length: owners }, () => emptyNode({ parentId: unit.id, head: true, title: ownerTitle }));
    nodes.splice(nodes.findIndex((n) => n.id === root.id), 0, ...heads);
    next = { ...next, nodes };
  }
  for (let i = 0; i < managers; i += 1) {
    next = addNode(next, emptyNode({ parentId: unit.id, title: managerTitle }));
  }
  return next;
}

/**
 * Adds a nested branch under parentId. Each item is a node's fields plus an
 * optional `children` array of the same shape; `{}` is a blank card.
 */
export function addTree(doc, parentId, items) {
  let next = doc;
  for (const { children, ...fields } of items) {
    const node = emptyNode({ ...fields, parentId });
    next = addNode(next, node);
    if (children?.length) next = addTree(next, node.id, children);
  }
  return next;
}

/** Updates fields; a parent change is ignored if it would create a cycle. */
export function updateNode(doc, id, patch) {
  const target = doc.nodes.find((n) => n.id === id);
  if (!target) return doc;
  const next = normalizeNode({ ...target, ...patch, id });

  if (next.parentId !== target.parentId) {
    const invalid =
      !target.parentId || // root stays root
      !next.parentId ||
      next.parentId === id ||
      getDescendantIds(doc, id).has(next.parentId) ||
      !doc.nodes.some((n) => n.id === next.parentId);
    if (invalid) next.parentId = target.parentId;
  }

  let nodes = doc.nodes.map((n) => (n.id === id ? next : n));
  if (next.parentId !== target.parentId) {
    // Move to the end of the new sibling group.
    nodes = nodes.filter((n) => n.id !== id);
    let insertAt = nodes.length;
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].parentId === next.parentId) {
        insertAt = i + 1;
        break;
      }
    }
    nodes.splice(insertAt, 0, next);
  }
  return touch(doc, nodes);
}

/**
 * Removes a node. mode 'cascade' removes the whole branch; 'reassign'
 * moves direct children up to the removed node's parent (in its place).
 * The root can only be removed if it has at most one child, which then
 * becomes the new root.
 */
export function removeNode(doc, id, mode = 'reassign') {
  const target = doc.nodes.find((n) => n.id === id);
  if (!target) return doc;

  if (!target.parentId) {
    const kids = getChildren(doc, id);
    if (kids.length > 1 && mode !== 'cascade') return doc;
    if (mode === 'cascade') return touch(doc, []);
    return touch(
      doc,
      doc.nodes.filter((n) => n.id !== id).map((n) => (n.parentId === id ? { ...n, parentId: null } : n))
    );
  }

  if (mode === 'cascade') {
    const drop = getDescendantIds(doc, id);
    drop.add(id);
    return touch(doc, doc.nodes.filter((n) => !drop.has(n.id)));
  }

  // Reassign: children take the removed node's slot, in order.
  const kids = doc.nodes.filter((n) => n.parentId === id).map((n) => ({ ...n, parentId: target.parentId }));
  const kidIds = new Set(kids.map((k) => k.id));
  const nodes = [];
  for (const n of doc.nodes) {
    if (n.id === id) nodes.push(...kids);
    else if (!kidIds.has(n.id)) nodes.push(n);
  }
  return touch(doc, nodes);
}

/** Moves a node one step among its siblings (direction -1 up, +1 down). */
export function moveSibling(doc, id, direction) {
  const target = doc.nodes.find((n) => n.id === id);
  if (!target) return doc;
  const siblings = doc.nodes.filter((n) => n.parentId === target.parentId);
  const index = siblings.findIndex((n) => n.id === id);
  const swapWith = siblings[index + direction];
  if (!swapWith) return doc;
  const nodes = [...doc.nodes];
  const a = nodes.findIndex((n) => n.id === id);
  const b = nodes.findIndex((n) => n.id === swapWith.id);
  [nodes[a], nodes[b]] = [nodes[b], nodes[a]];
  return touch(doc, nodes);
}

export function siblingPosition(doc, id) {
  const target = doc.nodes.find((n) => n.id === id);
  if (!target) return { index: -1, total: 0 };
  const siblings = doc.nodes.filter((n) => n.parentId === target.parentId);
  return { index: siblings.findIndex((n) => n.id === id), total: siblings.length };
}

// ─── Display helpers ─────────────────────────────────────────

export function initials(name) {
  const parts = cleanString(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export function telegramHandle(value) {
  const raw = cleanString(value).trim();
  if (!raw) return '';
  const fromUrl = raw.match(/t\.me\/([A-Za-z0-9_]+)/);
  const handle = (fromUrl ? fromUrl[1] : raw).replace(/^@+/, '').trim();
  return /^[A-Za-z0-9_]{3,}$/.test(handle) ? handle : '';
}

export function phoneHref(value) {
  const digits = cleanString(value).replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

/** Normalizes Ukrainian phone numbers to +380XXXXXXXXX when possible. */
export function normalizePhone(value) {
  if (value == null || value === '') return '';
  const raw = typeof value === 'number' ? value.toFixed(0) : String(value);
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('380')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('80')) return `+3${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) return `+38${digits}`;
  if (digits.length === 9) return `+380${digits}`;
  return raw.trim();
}

export function formatPhone(value) {
  const phone = normalizePhone(value);
  const m = phone.match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Splits duties text into renderable lines: { text, heading }. */
export function dutyLines(text) {
  return cleanString(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s"«»]*[-•–—*]?\s*/, '').replace(/["»]+\s*$/, '').replace(/[;.]\s*$/, '').trim())
    .filter((line) => line.length > 3)
    .map((line) => ({ text: line, heading: /:\s*$/.test(line) }));
}

export function brandList(value) {
  return cleanString(value)
    .split(/[,/;]+/)
    .map((b) => b.trim())
    .filter(Boolean);
}

export function matchesQuery(node, query) {
  const q = cleanString(query).trim().toLowerCase();
  if (!q) return true;
  return [node.name, node.title, node.brands, node.telegram, node.email, node.phone, node.duties]
    .some((field) => cleanString(field).toLowerCase().includes(q));
}
