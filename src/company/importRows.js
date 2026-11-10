// Converts the "Відділ маркетингу і бренд-менеджменту" contact sheet into a
// company structure document. Expected columns (header row contains "ПІБ"):
//   A: unit name (only on the first row of a block), B: №, C: ПІБ, D: Посада,
//   E: Бренд, F: Телеграм, G: Телефон, H: Пошта, I: З яких питань звертатись.
// Rules:
//   - the first person is the head of the whole structure (root);
//   - people before the first named block report to the root directly;
//   - each named block becomes a unit under the root;
//   - inside a unit, a person whose position starts with "Head" becomes a
//     sub-lead, and the following people report to the latest sub-lead.

import { UNIT_COLORS, emptyNode, normalizeDoc, normalizePhone, DOC_VERSION } from './model.js';

function text(value) {
  if (value == null) return '';
  return String(value).replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function cleanDuties(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\t+/g, ' ').trim())
    .map((line) => line.replace(/^"+|"+$/g, '').trim())
    .filter(Boolean);
  // A trailing fragment like "- роз" is a cut-off cell: drop it.
  while (lines.length && lines[lines.length - 1].replace(/^[-•\s]+/, '').length < 6) lines.pop();
  return lines.join('\n');
}

function cleanTelegram(value) {
  const raw = text(value);
  if (!raw) return '';
  return raw.startsWith('@') ? raw : `@${raw}`;
}

function findHeader(rows) {
  const index = rows.findIndex((row) => row.some((cell) => text(cell) === 'ПІБ'));
  if (index === -1) return null;
  const header = rows[index].map((cell) => text(cell).toLowerCase());
  const col = (...names) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const nameCol = col('піб');
  return {
    index,
    unit: 0,
    name: nameCol,
    title: col('посада'),
    brands: col('бренд'),
    telegram: col('телеграм', 'telegram'),
    phone: col('телефон'),
    email: col('пошта', 'email', 'e-mail'),
    // Duties have no header in the source file: the column right after email.
    duties: col('обов', 'з яких', 'питання') !== -1 ? col('обов', 'з яких', 'питання') : col('пошта', 'email') + 1,
  };
}

/**
 * Copies the value of every merged range into all of its cells, so a
 * shared "З яких питань звертатись" cell applies to each person in it.
 */
export function fillMerges(rows, merges = []) {
  const filled = rows.map((row) => [...row]);
  for (const range of merges || []) {
    const value = filled[range.s.r]?.[range.s.c];
    if (value == null || value === '') continue;
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      if (!filled[r]) filled[r] = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        if (r === range.s.r && c === range.s.c) continue;
        // Unit names (column A) must stay on the first row of their block.
        if (c === 0) continue;
        if (filled[r][c] == null || filled[r][c] === '') filled[r][c] = value;
      }
    }
  }
  return filled;
}

export function rowsToDoc(rawRows, { title = 'Структура компанії', subtitle = '', merges = [] } = {}) {
  const rows = fillMerges(rawRows, merges);
  const header = findHeader(rows);
  if (!header) throw new Error('Не знайдено рядок заголовків з колонкою «ПІБ».');

  const nodes = [];
  let root = null;
  let unit = null;
  let lead = null;
  let colorIndex = 0;
  const get = (row, key) => (header[key] >= 0 ? row[header[key]] : '');

  for (const row of rows.slice(header.index + 1)) {
    const unitName = text(row[header.unit]);
    const name = text(get(row, 'name'));

    if (unitName && root) {
      unit = emptyNode({
        type: 'unit',
        parentId: root.id,
        title: unitName,
        color: UNIT_COLORS[colorIndex % UNIT_COLORS.length],
      });
      colorIndex += 1;
      lead = null;
      nodes.push(unit);
    }
    if (!name) continue;

    const person = emptyNode({
      type: 'person',
      name,
      title: text(get(row, 'title')).replace(/\s*\n\s*/g, ' ').replace(/[\s/,]+$/, ''),
      brands: text(get(row, 'brands')),
      telegram: cleanTelegram(get(row, 'telegram')),
      phone: normalizePhone(get(row, 'phone')),
      email: text(get(row, 'email')),
      duties: cleanDuties(get(row, 'duties')),
    });

    if (!root) {
      root = person;
      nodes.push(person);
      continue;
    }

    if (!unit) {
      person.parentId = root.id;
    } else if (/^head\b/i.test(person.title)) {
      person.parentId = unit.id;
      lead = person;
    } else {
      person.parentId = (lead || unit).id;
    }
    nodes.push(person);
  }

  if (!root) throw new Error('У таблиці не знайдено жодного співробітника.');

  return normalizeDoc({
    version: DOC_VERSION,
    title,
    subtitle,
    nodes,
    updatedAt: new Date().toISOString(),
  });
}

/** Reads an .xlsx/.xls/.csv File in the browser (xlsx is loaded lazily). */
export async function fileToDoc(file, options) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true });
    if (rows.some((row) => row.some((cell) => String(cell).trim() === 'ПІБ'))) {
      return rowsToDoc(rows, { ...options, merges: sheet['!merges'] || [] });
    }
  }
  throw new Error('У файлі немає аркуша з колонкою «ПІБ».');
}
