import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  createProduct,
  fetchAccessLogEntries,
  fetchAdminOrders,
  fetchAllProducts,
  fetchProductImageSource,
  importProductImage,
  updateProduct,
} from '../lib/supabase';
import { SafeImage } from '../components/SafeImage';

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

const adminSections = [
  { id: 'title', label: 'Заголовок' },
  { id: 'create', label: 'Нова картка' },
  { id: 'colors', label: 'Кольори' },
  { id: 'details', label: 'Деталі картки' },
  { id: 'visibility', label: 'Видимість' },
  { id: 'access', label: 'Входи' },
  { id: 'orders', label: 'Замовлення' },
];

const DEFAULT_ADMIN_SECTION = 'details';

function normalizeAdminSection(section) {
  return adminSections.some((item) => item.id === section) ? section : DEFAULT_ADMIN_SECTION;
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '');
}

function formatKyivDateTime(value) {
  if (!value) return '';

  try {
    const formatted = new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));

    return `${formatted} Київ`;
  } catch {
    return '';
  }
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString('uk-UA');
}

function normalizeOrderItems(items) {
  if (Array.isArray(items)) return items;

  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

export function AdminPage({
  onBack,
  brandColors = {},
  onBrandColorChange,
  defaultBrandColor,
  catalogTitle,
  onCatalogTitleChange,
  defaultCatalogTitle,
  initialSection = DEFAULT_ADMIN_SECTION,
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Всі');
  const [activeSubCategory, setActiveSubCategory] = useState('Всі');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});
  const [saved, setSaved] = useState({});
  const [activeSection, setActiveSection] = useState(() => normalizeAdminSection(initialSection));
  const [newProduct, setNewProduct] = useState(emptyProductForm);
  const [creating, setCreating] = useState(false);
  const [createSaved, setCreateSaved] = useState(false);
  const [imageReloading, setImageReloading] = useState({});
  const [imageReloaded, setImageReloaded] = useState({});
  const [selectedBrand, setSelectedBrand] = useState('');
  const [catalogTitleDraft, setCatalogTitleDraft] = useState(catalogTitle);
  const [accessLogs, setAccessLogs] = useState([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
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
    setActiveSection(normalizeAdminSection(initialSection));
  }, [initialSection]);

  const loadAccessLogs = useCallback(async () => {
    setAccessLoading(true);
    setAccessError('');

    try {
      const data = await fetchAccessLogEntries();
      setAccessLogs(data);
    } catch (e) {
      setAccessLogs([]);
      setAccessError(e.message);
    } finally {
      setAccessLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError('');

    try {
      const data = await fetchAdminOrders();
      setOrders(data);
    } catch (e) {
      setOrders([]);
      setOrdersError(e.message);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === 'access') {
      loadAccessLogs();
    }

    if (activeSection === 'orders') {
      loadOrders();
    }
  }, [activeSection, loadAccessLogs, loadOrders]);

  useEffect(() => {
    setBrandColorDraft(selectedBrandColor);
  }, [selectedBrandColor]);

  useEffect(() => {
    setCatalogTitleDraft(catalogTitle);
  }, [catalogTitle]);

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

  const handleCatalogTitleInput = (value) => {
    setCatalogTitleDraft(value);
    onCatalogTitleChange(value.trim() || defaultCatalogTitle);
  };

  const handleRefresh = () => {
    if (activeSection === 'access') {
      loadAccessLogs();
      return;
    }

    if (activeSection === 'orders') {
      loadOrders();
      return;
    }

    load();
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

  const handleReloadImage = async (p) => {
    if (imageReloading[p.id]) return;

    setImageReloading((prev) => ({ ...prev, [p.id]: true }));
    setImageReloaded((prev) => ({ ...prev, [p.id]: false }));

    try {
      const sourceUrl = await fetchProductImageSource(p);

      if (!sourceUrl) {
        alert('У товару немає URL картинки для повторного завантаження.');
        return;
      }

      const imported = await importProductImage({
        productId: p.id,
        sourceUrl,
        sku: p.sku,
        name: p.name,
      });

      if (!imported?.product?.thumbnail_url) {
        throw new Error('Функція не повернула оновлений thumbnail_url.');
      }

      setProducts((prev) => prev.map((x) => (
        x.id === p.id
          ? {
              ...x,
              ...imported.product,
              source_thumbnail_url: imported.source_thumbnail_url || sourceUrl,
              image_storage_path: imported.image_storage_path,
              image_status: 'ok',
            }
          : x
      )));
      setImageReloaded((prev) => ({ ...prev, [p.id]: true }));
      setTimeout(() => {
        setImageReloaded((prev) => ({ ...prev, [p.id]: false }));
      }, 1800);
    } catch (e) {
      alert('Помилка оновлення фото: ' + e.message);
    } finally {
      setImageReloading((prev) => ({ ...prev, [p.id]: false }));
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
      let created = await createProduct(payload);

      try {
        const imported = await importProductImage({
          productId: created.id,
          sourceUrl: payload.thumbnail_url,
          sku: created.sku,
          name: created.name,
        });

        if (imported?.product?.thumbnail_url) {
          created = { ...created, ...imported.product };
        }
      } catch (imageError) {
        console.warn('Product image import skipped:', imageError);
      }

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

  const isProductSection = activeSection === 'details' || activeSection === 'visibility';

  return (
    <div className="admin-page">
      <div className="header">
        <div className="header-row">
          <button type="button" className="admin-back-btn" onClick={onBack}>
            ← Назад
          </button>
          <div className="header-title">Адмін</div>
          <div className="admin-header-actions">
            <button
              type="button"
              className="admin-add-btn"
              aria-label="Нова картка"
              onClick={() => setActiveSection('create')}
            >
              +
            </button>
            <button type="button" className="admin-refresh-btn" onClick={handleRefresh}>↻</button>
          </div>
        </div>
        {isProductSection && (
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
        )}
      </div>

      <div className="admin-section-tabs" role="tablist" aria-label="Розділи адмінки">
        {adminSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`admin-section-tab ${activeSection === section.id ? 'active' : ''}`}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>

      {activeSection === 'title' && (
        <div className="admin-settings-card admin-section-card">
          <div className="admin-create-head">
            <div className="admin-create-title">Зміна заголовку</div>
          </div>

          <label className="admin-label admin-title-label">
            <span>title</span>
            <input
              className="admin-input"
              type="text"
              value={catalogTitleDraft}
              placeholder={defaultCatalogTitle}
              onChange={(e) => handleCatalogTitleInput(e.target.value)}
              maxLength={28}
            />
          </label>
        </div>
      )}

      {activeSection === 'create' && (
        <form className="admin-create-card" onSubmit={handleCreateProduct}>
          <div className="admin-create-head">
            <div>
              <div className="admin-create-title">Нова картка</div>
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

      {activeSection === 'colors' && (
      <div className="admin-settings-card admin-section-card">
        <div className="admin-create-head">
          <div>
            <div className="admin-create-title">Налаштування кольорів</div>
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
      )}

      {activeSection === 'access' && (
        <div className="admin-activity-list">
          {accessLoading && <div className="admin-activity-loading">Завантаження…</div>}
          {accessError && <div className="admin-activity-error">{accessError}</div>}
          {!accessLoading && !accessError && accessLogs.map((entry) => (
            <article key={entry.id} className="admin-access-card">
              <div className="admin-access-person">
                <div className="admin-access-name">{entry.last_name || 'Без імені'}</div>
                <div className="admin-access-phone">{entry.phone || 'Без телефону'}</div>
              </div>
              <div className="admin-access-meta">
                {entry.tg_user_id && <span>TG {entry.tg_user_id}</span>}
                <time dateTime={entry.created_at}>{formatKyivDateTime(entry.created_at)}</time>
              </div>
            </article>
          ))}
        </div>
      )}

      {activeSection === 'orders' && (
        <div className="admin-receipt-list">
          {ordersLoading && <div className="admin-activity-loading">Завантаження…</div>}
          {ordersError && <div className="admin-activity-error">{ordersError}</div>}
          {!ordersLoading && !ordersError && orders.map((order) => {
            const items = normalizeOrderItems(order.items);

            return (
              <article key={order.id} className="admin-receipt">
                <div className="admin-receipt-head">
                  <div>
                    <div className="admin-receipt-title">Чек #{order.id}</div>
                    <div className="admin-receipt-date">{formatKyivDateTime(order.created_at)}</div>
                  </div>
                  {order.status && <span className="admin-receipt-status">{order.status}</span>}
                </div>

                <div className="admin-receipt-customer">
                  {order.last_name && <div>{order.last_name}</div>}
                  {order.phone && <div>{order.phone}</div>}
                  {order.tg_username && <div>@{order.tg_username}</div>}
                </div>

                {items.length > 0 && (
                  <div className="admin-receipt-lines">
                    {items.map((item, index) => {
                      const qty = Number(item.qty || 0);
                      const price = Number(item.price || 0);
                      const lineTotal = qty * price;

                      return (
                        <div key={`${item.id || item.sku || index}-${index}`} className="admin-receipt-line">
                          <div className="admin-receipt-line-main">
                            <span className="admin-receipt-item-name">{item.name || 'Товар'}</span>
                            {item.sku && <span className="admin-receipt-item-sku">{item.sku}</span>}
                          </div>
                          <div className="admin-receipt-line-price">
                            <span>{qty} x {formatPrice(price)} ₴</span>
                            <strong>{formatPrice(lineTotal)} ₴</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="admin-receipt-total">
                  <span>Разом</span>
                  <strong>{formatPrice(order.total)} ₴</strong>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isProductSection && (
      <>
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
          const isImageReloading = imageReloading[p.id];
          const isImageReloaded = imageReloaded[p.id];

          return (
            <div
              key={p.id}
              className={`admin-card ${activeSection === 'visibility' ? 'admin-card--visibility' : ''} ${!p.view ? 'admin-card--hidden' : ''}`}
            >
              <div className="admin-card-top">
                <SafeImage
                  className="admin-card-img"
                  placeholderClassName="admin-card-img admin-card-img--placeholder"
                  src={p.thumbnail_url}
                  alt={p.name}
                />
                <div className="admin-card-info">
                  <div className="admin-card-name">{p.name}</div>
                  {p.sku && <div className="admin-card-sku">{p.sku}</div>}
                  <div className="admin-card-cat">{p.category}</div>
                </div>
                {activeSection === 'details' ? (
                  <div className="admin-card-actions">
                    <button
                      type="button"
                      className="admin-image-refresh"
                      disabled={isImageReloading}
                      onClick={() => handleReloadImage(p)}
                    >
                      {isImageReloading ? 'Оновлення…' : '↻ Фото'}
                    </button>
                    {isImageReloaded && <span className="admin-image-refreshed">✓ Фото</span>}
                  </div>
                ) : (
                  <div className="admin-card-actions">
                    <button
                      type="button"
                      className={`admin-toggle ${p.view ? 'admin-toggle--on' : 'admin-toggle--off'}`}
                      disabled={isSaving}
                      onClick={() => handleToggleView(p)}
                    >
                      {p.view ? 'Видимий' : 'Прихований'}
                    </button>
                  </div>
                )}
              </div>

              {activeSection === 'details' && (
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
              )}
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
