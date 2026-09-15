import React, { useMemo, useRef, useState } from 'react';
import { SafeImage } from './SafeImage';
import { isComingSoon } from '../lib/productDisplay';
import { detectPriceColumns, parsePrice, previewPriceImport, savePriceChanges } from '../lib/pricing';
import { updateProduct } from '../lib/supabase';

const money = (value) => value == null ? '—' : Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
const PAGE_SIZE = 60;

export function AdminPricing({ products, setProducts, loading, loadError, onBusyChange }) {
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [columns, setColumns] = useState({ barcode: 0, price: 1, header: true });
  const [report, setReport] = useState(null);
  const lock = useRef(false);
  const changes = useMemo(() => products.filter((p) => Object.hasOwn(drafts, p.id))
    .map((p) => ({ id: p.id, price: parsePrice(drafts[p.id]) })), [products, drafts]);
  const invalid = changes.some((change) => change.price === null);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  const filtered = useMemo(() => products.filter((p) =>
    (!category || p.category === category)
    && (!onlyChanged || Object.hasOwn(drafts, p.id))
    && `${p.name} ${p.sku || ''}`.toLocaleLowerCase('uk-UA').includes(query.trim().toLocaleLowerCase('uk-UA'))
  ), [products, category, onlyChanged, drafts, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = sheets[sheetIndex]?.rows || [];
  const columnCount = Math.max(2, ...rows.slice(0, 20).map((row) => row.length));

  function editPrice(product, value) {
    setDrafts((current) => {
      const next = { ...current };
      if (parsePrice(value) !== null && product.price !== null && parsePrice(value) === Number(product.price)) delete next[product.id];
      else next[product.id] = value;
      return next;
    });
    setNotice('');
  }

  async function readFile(file) {
    if (!file) return;
    setError(''); setNotice(''); setReport(null); setSheets([]); setFileName('');
    if (!/\.(xlsx|xls)$/i.test(file.name)) { setError('Оберіть Excel-файл .xlsx або .xls.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Максимальний розмір файлу — 10 МБ.'); return; }
    setReading(true);
    try {
      const { readPriceWorkbook } = await import('../lib/priceWorkbook');
      const parsed = readPriceWorkbook(await file.arrayBuffer());
      if (!parsed.some((sheet) => sheet.rows.length)) throw new Error('У файлі немає даних.');
      const index = parsed.findIndex((sheet) => sheet.rows.length);
      setSheets(parsed); setSheetIndex(index); setColumns(detectPriceColumns(parsed[index].rows)); setFileName(file.name);
    } catch (e) { setError(`Не вдалося прочитати Excel. ${e.message}`); }
    finally { setReading(false); }
  }

  function prepareImport() {
    try {
      const preview = previewPriceImport(rows, products, columns);
      setReport(preview);
      setDrafts(Object.fromEntries(preview.changes.map((change) => [change.id, String(change.price)])));
      setOnlyChanged(true); setQuery(''); setCategory(''); setPage(0); setError(''); setNotice('');
    } catch (e) { setError(e.message); }
  }

  async function save() {
    if (lock.current || !changes.length || invalid) return;
    lock.current = true; setBusy(true); onBusyChange(true); setProgress(0); setError(''); setNotice('');
    try {
      const result = await savePriceChanges(changes, (change) => updateProduct(change.id, { price: change.price }), setProgress);
      const savedById = new Map(result.saved.map((change) => [change.id, change.price]));
      setProducts((current) => current.map((p) => savedById.has(p.id) ? { ...p, price: savedById.get(p.id) } : p));
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !result.saved.some((change) => String(change.id) === id))));
      setNotice(`Збережено цін: ${result.saved.length}.`);
      if (result.failed.length) setError(`Не збережено: ${result.failed.length}. Ці рядки залишилися для повторної спроби. ${result.failed[0].error}`);
      else { setReport(null); setSheets([]); setFileName(''); }
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }

  function discard() {
    setDrafts({}); setReport(null); setNotice(''); setError(''); setOnlyChanged(false);
  }

  return (
    <section className="pricing" aria-label="Переоцінка товарів">
      <div className="pricing-hero">
        <div><span className="pricing-eyebrow">КЕРУВАННЯ КАТАЛОГОМ</span><h1>Переоцінка<span>↗</span></h1>
          <p>Базові ціни до знижок бренду.<br />Редагуйте вручну або оновлюйте з Excel.</p></div>
        <div className="pricing-stats"><div><strong>{products.length}</strong><span>товарів у каталозі</span></div>
          <div><strong>{changes.length}</strong><span>цін до збереження</span></div></div>
      </div>

      <div className="pricing-import">
        <div className="pricing-import-heading"><span className="pricing-file-icon" aria-hidden="true">↥</span>
          <div><h2>Оновлення з Excel</h2><p>Штрихкод + вартість. Оновимо всі картки зі збігом.</p></div></div>
        <div className="pricing-import-actions">
          <button className="pricing-secondary" disabled={busy || reading} onClick={async () => {
            try { const module = await import('../lib/priceWorkbook'); module.downloadPriceTemplate(); }
            catch (e) { setError(e.message); }
          }}>↓ Шаблон Excel</button>
          <label className={`pricing-upload ${busy || reading || loading || loadError || changes.length ? 'is-disabled' : ''}`}>
            {reading ? 'Читаємо файл…' : '↑ Обрати файл'}
            <input aria-label="Завантажити Excel з цінами" type="file" accept=".xlsx,.xls" disabled={busy || reading || loading || Boolean(loadError) || changes.length > 0}
              onChange={(event) => { readFile(event.target.files?.[0]); event.target.value = ''; }} />
          </label>
        </div>
        <p className="pricing-import-hint">.xlsx або .xls · до 10 МБ · штрихкоди з початковими нулями зберігайте як текст. Перед новим імпортом збережіть або скасуйте поточні зміни.</p>
        {sheets.length > 0 && <div className="pricing-mapping">
          <strong className="pricing-filename">{fileName}</strong>
          <label>Аркуш<select disabled={busy || changes.length > 0} value={sheetIndex} onChange={(e) => {
            const index = Number(e.target.value); setSheetIndex(index); setColumns(detectPriceColumns(sheets[index].rows)); setReport(null);
          }}>{sheets.map((sheet, i) => <option key={i} value={i}>{sheet.name}</option>)}</select></label>
          {[['barcode', 'Штрихкод'], ['price', 'Вартість']].map(([key, label]) => <label key={key}>{label}
            <select value={columns[key]} disabled={busy || changes.length > 0} onChange={(e) => setColumns({ ...columns, [key]: Number(e.target.value) })}>
              {Array.from({ length: columnCount }, (_, i) => <option key={i} value={i}>Колонка {i + 1}{rows[0]?.[i] !== undefined ? ` · ${String(rows[0][i]).slice(0, 40)}` : ''}</option>)}
            </select></label>)}
          <label className="pricing-check"><input type="checkbox" checked={columns.header} disabled={busy || changes.length > 0} onChange={(e) => setColumns({ ...columns, header: e.target.checked })} /> Перший рядок — заголовки</label>
          <button className="admin-save-btn" disabled={busy || loading || Boolean(loadError) || changes.length > 0 || !rows.length} onClick={prepareImport}>Перевірити збіги</button>
        </div>}
        {report && <div className="pricing-report" role="status">
          <strong>Готово до оновлення: {report.changes.length} карток</strong>
          <span>Рядків у файлі: {report.results.length} · Без змін: {report.results.filter((r) => r.status === 'Без змін').length} · Пропущено: {report.results.filter((r) => !['До оновлення', 'Без змін'].includes(r.status)).length}</span>
          <details><summary>Переглянути результат перевірки</summary><div className="pricing-report-scroll"><table><thead><tr><th>Рядок</th><th>Штрихкод</th><th>Ціна з файлу</th><th>Результат</th></tr></thead>
            <tbody>{report.results.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.sku || '—'}</td><td>{String(r.price ?? '')}</td><td>{r.status}</td></tr>)}</tbody></table></div></details>
        </div>}
      </div>

      <div className="pricing-toolbar">
        <input aria-label="Пошук для переоцінки" type="search" placeholder="Пошук за назвою або штрихкодом" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
        <select aria-label="Категорія для переоцінки" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}><option value="">Усі категорії</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        <label className="pricing-check"><input type="checkbox" checked={onlyChanged} onChange={(e) => { setOnlyChanged(e.target.checked); setPage(0); }} /> Лише змінені</label>
      </div>
      {(error || loadError) && <div className="pricing-error" role="alert">{error || loadError}</div>}
      {notice && <div className="pricing-success" role="status">✓ {notice}</div>}
      <div className="pricing-table-wrap"><table className="pricing-table"><thead><tr><th>Товар</th><th>Штрихкод</th><th>Базова ціна</th><th>Нова базова ціна, ₴</th><th>Різниця</th></tr></thead>
        <tbody>{!loading && !loadError && filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((p) => {
          const changed = Object.hasOwn(drafts, p.id);
          const nextPrice = changed ? parsePrice(drafts[p.id]) : null;
          const delta = changed && nextPrice !== null && p.price !== null ? Math.round((nextPrice - Number(p.price)) * 100) / 100 : null;
          return <tr key={p.id} className={changed ? 'pricing-row-changed' : ''}>
            <td><div className="pricing-product"><SafeImage className="pricing-thumbnail" src={p.thumbnail_url} alt="" /><div><strong>{p.name}</strong><span>{p.category || 'Без категорії'}{!p.view ? ' · Прихований' : ''}</span>
              {isComingSoon(p) && <span className="pricing-soon">Скоро.. · ціна прихована в каталозі</span>}</div></div></td>
            <td className="pricing-barcode">{p.sku || '—'}</td><td className="pricing-money">{money(p.price)}{p.price != null ? ' ₴' : ''}</td>
            <td><input className="pricing-price-input" aria-label={`Нова ціна ${p.name}`} aria-invalid={changed && nextPrice === null} inputMode="decimal" disabled={busy}
              value={drafts[p.id] ?? String(p.price ?? '')} onChange={(e) => editPrice(p, e.target.value)} />
              {changed && nextPrice === null && <small className="pricing-input-error">Від 0, до 2 знаків після коми</small>}</td>
            <td><span className={`pricing-delta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>{delta === null || delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${money(delta)} ₴`}</span></td>
          </tr>;
        })}</tbody></table>
        {(loading || !filtered.length) && <div className="pricing-empty">{loading ? 'Завантажуємо товари…' : onlyChanged ? 'Немає змінених цін' : 'Товарів не знайдено'}</div>}
      </div>
      <div className="pricing-pagination"><span>Знайдено: {filtered.length} · Сторінка {safePage + 1} з {pageCount}</span><div>
        <button className="pricing-secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Назад</button>
        <button className="pricing-secondary" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Далі →</button></div></div>
      <div className="pricing-savebar"><div><strong>{busy ? `Збереження ${progress} / ${changes.length}` : `Змінено цін: ${changes.length}`}</strong><span>Зміни застосуються до всіх карток після збереження.</span></div>
        <button className="pricing-secondary" disabled={busy || !changes.length} onClick={discard}>Скасувати зміни</button>
        <button className="admin-save-btn" disabled={busy || loading || Boolean(loadError) || !changes.length || invalid} onClick={save}>{busy ? 'Зберігаємо…' : `Зберегти ціни${changes.length ? ` · ${changes.length}` : ''}`}</button>
      </div>
    </section>
  );
}
