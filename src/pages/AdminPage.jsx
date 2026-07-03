import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createProduct, fetchAllProducts, updateProduct } from '../lib/supabase';

const emptyProductForm = {
  id: '',
  name: '',
  sku: '',
  price: '',
  thumbnail_url: '',
  category: '',
  p_category: '',
};

const brandColorPresets = [
  '#075985', '#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6',
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f59e0b',
  '#f97316', '#ea580c', '#ef4444', '#e11d48', '#be123c',
  '#db2777', '#c026d3', '#9333ea', '#7c3aed', '#4f46e5',
  '#2563eb', '#1d4ed8', '#334155', '#111827',
];

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '');
}

export function AdminPage({ onBack, brandColors = {}, onBrandColorChange, defaultBrandColor }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Всі');
  const [activeSubCategory, setActiveSubCategory] = useState('Всі');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});
  const [saved, setSaved] = useState({});
  const [isAdding, setIsAdding] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyProductForm);
  const [creating, setCreating] = useState(false);
  const [createSaved, setCreateSaved] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState('');
  const selectedBrandColor = selectedBrand
    ? (brandColors[selectedBrand] || defaultBrandColor)
    : defaultBrandColor;
  const [brandColorDraft, setBrandColorDraft] = useState(selectedBrandColor);

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

  useEffect(() => {
    setBrandColorDraft(selectedBrandColor);
  }, [selectedBrandColor]);

  const allCategories = useMemo(() => {
    const unique = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    return ['Всі', ...unique];
  }, [products]);

  const categoryOptions = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );

  useEffect(() => {
    if (categoryOptions.length === 0) {
      setSelectedBrand('');
      return;
    }

    if (!selectedBrand || !categoryOptions.includes(selectedBrand)) {
      setSelectedBrand(categoryOptions[0]);
    }
  }, [categoryOptions, selectedBrand]);

  const subCategoryOptions = useMemo(() => {
    const source = newProduct.category
      ? products.filter((p) => p.category === newProduct.category)
      : products;

    return [...new Set(source.map((p) => p.p_category).filter(Boolean))].sort();
  }, [products, newProduct.category]);

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
    number_sites: edits[p.id]?.number_sites ?? String(p.number_sites ?? ''),
  });

  const isDirty = (p) => {
    const e = edits[p.id];
    if (!e) return false;
    return (
      (e.p_category !== undefined && e.p_category !== (p.p_category || '')) ||
      (e.badge !== undefined && e.badge !== (p.badge || '')) ||
      (e.category !== undefined && e.category !== (p.category || '')) ||
      (e.price !== undefined && e.price !== String(p.price ?? '')) ||
      (e.number_sites !== undefined && e.number_sites !== String(p.number_sites ?? ''))
    );
  };

  const handleField = (id, field, value) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setSaved((prev) => ({ ...prev, [id]: false }));
  };

  const handleNewProductField = (field, value) => {
    setNewProduct((prev) => ({ ...prev, [field]: value }));
    setCreateSaved(false);
  };

  const handleBrandColorInput = (value) => {
    setBrandColorDraft(value);
    if (selectedBrand && isHexColor(value)) {
      onBrandColorChange(selectedBrand, value);
    }
  };

  const handleBrandColorChange = (value) => {
    setBrandColorDraft(value);
    if (selectedBrand) {
      onBrandColorChange(selectedBrand, value);
    }
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
    if (e.number_sites !== undefined) fields.number_sites = e.number_sites === '' ? null : Number(e.number_sites);
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

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (creating) return;

    const id = Number(newProduct.id);
    const price = Number(newProduct.price);

    if (!Number.isInteger(id) || id <= 0) {
      alert('Вкажіть коректний id.');
      return;
    }

    if (!newProduct.name.trim()) {
      alert('Вкажіть name.');
      return;
    }

    if (!newProduct.sku.trim()) {
      alert('Вкажіть sku.');
      return;
    }

    if (!newProduct.price.trim() || !Number.isFinite(price)) {
      alert('Вкажіть коректну price.');
      return;
    }

    if (!newProduct.thumbnail_url.trim()) {
      alert('Вкажіть thumbnail_url.');
      return;
    }

    if (!newProduct.category.trim()) {
      alert('Вкажіть category.');
      return;
    }

    if (!newProduct.p_category.trim()) {
      alert('Вкажіть p_category.');
      return;
    }

    const maxOrder = products.reduce((max, p) => {
      const order = Number(p.number_sites);
      return Number.isFinite(order) ? Math.max(max, order) : max;
    }, 0);

    const payload = {
      id,
      name: newProduct.name.trim(),
      sku: newProduct.sku.trim(),
      price,
      thumbnail_url: newProduct.thumbnail_url.trim(),
      category: newProduct.category.trim(),
      p_category: newProduct.p_category.trim(),
      badge: null,
      view: true,
      number_sites: maxOrder + 1,
    };

    setCreating(true);
    try {
      const created = await createProduct(payload);
      setProducts((prev) => [...prev, created].sort((a, b) => {
        const aOrder = Number(a.number_sites ?? 0);
        const bOrder = Number(b.number_sites ?? 0);
        return aOrder - bOrder;
      }));
      setNewProduct(emptyProductForm);
      setCreateSaved(true);
      setTimeout(() => setCreateSaved(false), 1500);
    } catch (err) {
      alert('Помилка: ' + err.message);
    } finally {
      setCreating(false);
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
          <div className="admin-header-actions">
            <button type="button" className="admin-add-btn" onClick={() => setIsAdding((value) => !value)}>
              {isAdding ? '×' : '+'}
            </button>
            <button type="button" className="admin-refresh-btn" onClick={load}>↻</button>
          </div>
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

      {isAdding && (
        <form className="admin-create-card" onSubmit={handleCreateProduct}>
          <div className="admin-create-head">
            <div>
              <div className="admin-create-title">Новий товар</div>
            </div>
            {createSaved && <span className="admin-saved-badge">✓ Створено</span>}
          </div>

          <div className="admin-create-grid">
            <label className="admin-label">
              <span>id</span>
              <input className="admin-input" type="number" inputMode="numeric" value={newProduct.id} placeholder="id"
                onChange={(e) => handleNewProductField('id', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>name</span>
              <input className="admin-input" type="text" value={newProduct.name} placeholder="назва товару"
                onChange={(e) => handleNewProductField('name', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>sku</span>
              <input className="admin-input" type="text" inputMode="numeric" value={newProduct.sku} placeholder="штрихкод"
                onChange={(e) => handleNewProductField('sku', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>price</span>
              <input className="admin-input" type="number" inputMode="decimal" step="0.01" value={newProduct.price} placeholder="ціна"
                onChange={(e) => handleNewProductField('price', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>category</span>
              <input className="admin-input" type="text" list="admin-category-options" value={newProduct.category} placeholder="оберіть або введіть"
                onChange={(e) => handleNewProductField('category', e.target.value)} />
            </label>
            <label className="admin-label">
              <span>p_category</span>
              <input className="admin-input" type="text" list="admin-subcategory-options" value={newProduct.p_category} placeholder="оберіть або введіть"
                onChange={(e) => handleNewProductField('p_category', e.target.value)} />
            </label>
            <label className="admin-label admin-label--wide">
              <span>thumbnail</span>
              <input className="admin-input" type="url" value={newProduct.thumbnail_url} placeholder="https://..."
                onChange={(e) => handleNewProductField('thumbnail_url', e.target.value)} />
            </label>
          </div>

          <datalist id="admin-category-options">
            {categoryOptions.map((category) => <option key={category} value={category} />)}
          </datalist>
          <datalist id="admin-subcategory-options">
            {subCategoryOptions.map((subCategory) => <option key={subCategory} value={subCategory} />)}
          </datalist>

          <button type="submit" className="admin-save-btn admin-create-submit" disabled={creating}>
            {creating ? 'Створення…' : 'Додати товар'}
          </button>
        </form>
      )}

      <div className="admin-settings-card">
        <div className="admin-create-head">
          <div>
            <div className="admin-create-title">Налаштування</div>
            <div className="admin-settings-subtitle">Колір зберігається окремо для кожного бренду</div>
          </div>
        </div>

        <label className="admin-label admin-brand-select-label">
          <span>brand</span>
          <select
            className="admin-input admin-brand-select"
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            disabled={categoryOptions.length === 0}
          >
            {categoryOptions.length === 0 ? (
              <option value="">Немає брендів</option>
            ) : (
              categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))
            )}
          </select>
        </label>

        <div className="admin-brand-row">
          <label className="admin-brand-picker">
            <input
              type="color"
              value={selectedBrandColor}
              onChange={(e) => handleBrandColorChange(e.target.value)}
              aria-label="Колір бренду"
              disabled={!selectedBrand}
            />
            <span style={{ background: selectedBrandColor }} />
          </label>
          <input
            className="admin-input admin-brand-hex"
            type="text"
            value={brandColorDraft}
            maxLength={7}
            onChange={(e) => handleBrandColorInput(e.target.value)}
            placeholder="#075985"
          />
          <button
            type="button"
            className="admin-reset-btn"
            onClick={() => handleBrandColorChange(defaultBrandColor)}
            disabled={!selectedBrand}
          >
            Скинути
          </button>
        </div>

        <div className="admin-brand-presets">
          {brandColorPresets.map((color) => (
            <button
              key={color}
              type="button"
              className={`admin-brand-swatch ${selectedBrandColor.toLowerCase() === color ? 'active' : ''}`}
              style={{ background: color }}
              aria-label={`Обрати колір ${color}`}
              onClick={() => handleBrandColorChange(color)}
              disabled={!selectedBrand}
            />
          ))}
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
                <label className="admin-label">
                  <span>number_sites</span>
                  <input className="admin-input" type="number" inputMode="numeric" value={edit.number_sites} placeholder="порядок"
                    onChange={(e) => handleField(p.id, 'number_sites', e.target.value)} />
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
