import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchAllProducts, updateProduct } from '../lib/supabase';

export function AdminPage({ onBack }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Всі');
  const [activeSubCategory, setActiveSubCategory] = useState('Всі');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});
  const [saved, setSaved] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAllProducts();
      setProducts(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allCategories = useMemo(() => {
    const unique = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    return ['Всі', ...unique];
  }, [products]);

  const subCategories = useMemo(() => {
    if (activeCategory === 'Всі') return [];
    const unique = [...new Set(
      products.filter((p) => p.category === activeCategory).map((p) => p.p_category).filter(Boolean)
    )].sort();
    return unique.length ? ['Всі', ...unique] : [];
  }, [products, activeCategory]);

  const handleCategoryClick = (cat) => {
    setActiveCategory(cat);
    setActiveSubCategory('Всі');
  };

  const filtered = useMemo(() => {
    let result = products;
    if (search.trim()) {
      const words = search.toLowerCase().trim().split(/\s+/);
      result = result.filter((p) => {
        const hay = `${p.name || ''} ${p.category || ''} ${p.p_category || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    } else {
      if (activeCategory !== 'Всі') result = result.filter((p) => p.category === activeCategory);
      if (activeCategory !== 'Всі' && activeSubCategory !== 'Всі')
        result = result.filter((p) => p.p_category === activeSubCategory);
    }
    return result;
  }, [products, search, activeCategory, activeSubCategory]);

  const getEdit = (p) => ({
    p_category: edits[p.id]?.p_category ?? (p.p_category || ''),
    badge: edits[p.id]?.badge ?? (p.badge || ''),
    category: edits[p.id]?.category ?? (p.category || ''),
    price: edits[p.id]?.price ?? String(p.price ?? ''),
  });

  const isDirty = (p) => {
    const e = edits[p.id];
    if (!e) return false;
    return (
      (e.p_category !== undefined && e.p_category !== (p.p_category || '')) ||
      (e.badge !== undefined && e.badge !== (p.badge || '')) ||
      (e.category !== undefined && e.category !== (p.category || '')) ||
      (e.price !== undefined && e.price !== String(p.price ?? ''))
    );
  };

  const handleField = (id, field, value) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setSaved((prev) => ({ ...prev, [id]: false }));
  };

  const handleToggleView = async (p) => {
    setSaving((prev) => ({ ...prev, [p.id]: true }));
    try {
      await updateProduct(p.id, { view: !p.view });
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, view: !x.view } : x)));
    } catch (e) {
      alert('Помилка: ' + e.message);
    } finally {
      setSaving((prev) => ({ ...prev, [p.id]: false }));
    }
  };

  const handleSave = async (p) => {
    const e = edits[p.id] || {};
    const fields = {};
    if (e.p_category !== undefined) fields.p_category = e.p_category || null;
    if (e.badge !== undefined) fields.badge = e.badge || null;
    if (e.category !== undefined) fields.category = e.category || null;
    if (e.price !== undefined) fields.price = e.price === '' ? null : Number(e.price);
    if (!Object.keys(fields).length) return;

    setSaving((prev) => ({ ...prev, [p.id]: true }));
    try {
      await updateProduct(p.id, fields);
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...fields } : x)));
      setEdits((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
      setSaved((prev) => ({ ...prev, [p.id]: true }));
      setTimeout(() => setSaved((prev) => ({ ...prev, [p.id]: false })), 1500);
    } catch (e) {
      alert('Помилка: ' + e.message);
    } finally {
      setSaving((prev) => ({ ...prev, [p.id]: false }));
    }
  };

  return (
    <div className="admin-page">
      <div className="header">
        <div className="header-row">
          <button type="button" className="admin-back-btn" onClick={onBack}>
            ← Назад
          </button>
          <div className="header-title">Адмін</div>
          <button type="button" className="admin-refresh-btn" onClick={load}>↻</button>
        </div>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            type="text"
            inputMode="search"
            placeholder="Пошук товарів…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch('')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Категорії */}
      <div className="categories-scroll">
        {allCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`category-chip ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => handleCategoryClick(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Підкатегорії */}
      {subCategories.length > 1 && (
        <div className="categories-scroll" style={{ paddingTop: 4, paddingBottom: 12 }}>
          {subCategories.map((sub) => (
            <button
              key={sub}
              type="button"
              className={`category-chip ${activeSubCategory === sub ? 'active' : ''}`}
              onClick={() => setActiveSubCategory(sub)}
              style={activeSubCategory === sub ? {} : { background: 'rgba(255,255,255,0.5)', borderColor: 'rgba(14,165,233,0.1)' }}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      <div className="admin-content">
        {loading && <div className="no-results" style={{ paddingTop: 48 }}>Завантаження…</div>}
        {error && <div className="no-results" style={{ paddingTop: 48, color: '#ef4444' }}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="no-results" style={{ paddingTop: 48 }}>Нічого не знайдено</div>
        )}
        {!loading && !error && filtered.map((p) => {
          const edit = getEdit(p);
          const dirty = isDirty(p);
          const isSaving = saving[p.id];
          const isSaved = saved[p.id];

          return (
            <div key={p.id} className={`admin-card ${!p.view ? 'admin-card--hidden' : ''}`}>
              <div className="admin-card-top">
                {p.thumbnail_url ? (
                  <img className="admin-card-img" src={p.thumbnail_url} alt={p.name} />
                ) : (
                  <div className="admin-card-img admin-card-img--placeholder">📦</div>
                )}
                <div className="admin-card-info">
                  <div className="admin-card-name">{p.name}</div>
                  {p.sku && <div className="admin-card-sku">{p.sku}</div>}
                  <div className="admin-card-cat">{p.category}</div>
                </div>
                <button
                  type="button"
                  className={`admin-toggle ${p.view ? 'admin-toggle--on' : 'admin-toggle--off'}`}
                  disabled={isSaving}
                  onClick={() => handleToggleView(p)}
                >
                  {p.view ? 'Видимий' : 'Прихований'}
                </button>
              </div>

              <div className="admin-card-fields">
                <label className="admin-label">
                  <span>category</span>
                  <input className="admin-input" type="text" value={edit.category} placeholder="категорія"
                    onChange={(e) => handleField(p.id, 'category', e.target.value)} />
                </label>
                <label className="admin-label">
                  <span>p_category</span>
                  <input className="admin-input" type="text" value={edit.p_category} placeholder="підкатегорія"
                    onChange={(e) => handleField(p.id, 'p_category', e.target.value)} />
                </label>
                <label className="admin-label">
                  <span>badge</span>
                  <input className="admin-input" type="text" value={edit.badge} placeholder="хіт / new / акція"
                    onChange={(e) => handleField(p.id, 'badge', e.target.value)} />
                </label>
                <label className="admin-label">
                  <span>price</span>
                  <input className="admin-input" type="number" inputMode="decimal" value={edit.price} placeholder="ціна"
                    onChange={(e) => handleField(p.id, 'price', e.target.value)} />
                </label>
                {dirty && (
                  <button type="button" className="admin-save-btn" disabled={isSaving} onClick={() => handleSave(p)}>
                    {isSaving ? 'Збереження…' : 'Зберегти'}
                  </button>
                )}
                {isSaved && <span className="admin-saved-badge">✓ Збережено</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
