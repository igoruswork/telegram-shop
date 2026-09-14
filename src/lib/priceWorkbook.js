import { read, utils, writeFileXLSX } from 'xlsx';

export function readPriceWorkbook(data) {
  const workbook = read(data, { type: 'array', cellDates: false, cellNF: true, sheetRows: 20002 });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const range = utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.e.r > 20000 || range.e.c > 100) throw new Error('Максимум 20 000 рядків і 100 колонок на аркуші.');
    // Preserve padded barcodes, but keep numeric prices independent of currency formatting.
    const rows = utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < rows[r].length; c += 1) {
        const cell = sheet[utils.encode_cell({ r: r + range.s.r, c: c + range.s.c })];
        if (cell?.t === 'n' && /^0+$/.test(cell.z || '') && cell.w) rows[r][c] = cell.w;
      }
    }
    return { name, rows };
  });
}

export function downloadPriceTemplate() {
  const sheet = utils.aoa_to_sheet([['Штрихкод', 'Вартість'], ['0012345678905', 125.5]]);
  sheet['!cols'] = [{ wch: 24 }, { wch: 18 }];
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, 'Ціни');
  writeFileXLSX(workbook, 'Шаблон переоцінки.xlsx');
}
