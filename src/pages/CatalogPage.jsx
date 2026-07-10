import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useSingleTap } from '../lib/useSingleTap';
import { ProductCard } from '../components/ProductCard';
import { SafeImage } from '../components/SafeImage';

function formatPrice(price) {
  return Number(price).toLocaleString('uk-UA');
}

function getBadgeClass(badge) {
  if (!badge) return '';
  const b = badge.toLowerCase();
  if (b.includes('хіт') || b.includes('hit')) return 'hit';
  if (b.includes('нов') || b.includes('new')) return 'new';
  if (b.includes('акц') || b.includes('sale')) return 'sale';
  return 'default';
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '');
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ].join(', ');
}

function darkenHex(hex, amount = 0.34) {
  const value = hex.replace('#', '');
  const channels = [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];

  const darkened = channels
    .map((channel) => Math.max(0, Math.round(channel * (1 - amount))))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');

  return `#${darkened}`;
}

function getBrandStyle(category, brandColors, defaultBrandColor) {
  const color = brandColors?.[category] || defaultBrandColor;
  const validColor = isHexColor(color) ? color : defaultBrandColor;

  return {
    '--brand-color': validColor,
    '--brand-price-color': darkenHex(validColor),
    '--brand-rgb': hexToRgb(validColor),
  };
}

const adminShortcuts = [
  { section: 'access', label: 'Входи', icon: 'access' },
  { section: 'orders', label: 'Замовлення', icon: 'orders' },
  { section: 'visibility', label: 'Видимість', icon: 'visibility' },
  { section: 'title', label: 'Налаштування', icon: 'settings' },
];

function AdminShortcutIcon({ icon }) {
  if (icon === 'access') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.8 19c.7-3.4 2.9-5.2 5.2-5.2s4.5 1.8 5.2 5.2" />
        <path d="M15.2 11.8l2 2 3.6-4.2" />
      </svg>
    );
  }

  if (icon === 'orders') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1-2 1.1V5A1.5 1.5 0 0 1 7 3.5z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </svg>
    );
  }

  if (icon === 'visibility') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.7 12s3.4-5.8 9.3-5.8 9.3 5.8 9.3 5.8-3.4 5.8-9.3 5.8S2.7 12 2.7 12z" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8l1.3 2.3 2.6.5.8 2.5 2.3 1.3-1 2.6 1 2.6-2.3 1.3-.8 2.5-2.6.5-1.3 2.3-1.3-2.3-2.6-.5-.8-2.5L5 14.6 6 12 5 9.4l2.3-1.3.8-2.5 2.6-.5L12 2.8z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10" />
      <path d="M14 8l4 4-4 4" />
      <path d="M8.5 12H18" />
    </svg>
  );
}

export function CatalogPage({
  products,
  categories,
  loading,
  error,
  onProductClick,
  onAddToCart,
  cartCount,
  cartTotal,
  onCartClick,
  cart,
  onUpdateQty,
  isAdmin,
  onAdminClick,
  savedState,
  onSaveState,
  brandColors,
  defaultBrandColor,
  userName,
  onLogout,
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(savedState?.activeCategory || 'Всі');
  const [activeSubCategory, setActiveSubCategory] = useState(savedState?.activeSubCategory || 'Всі');
  const [headerCompact, setHeaderCompact] = useState(false);
  const bindSingleTap = useSingleTap();
  const searchRef = useRef(null);

  // Відновлення позиції скролу після монтування
  useEffect(() => {
    if (savedState?.scrollY) {
      requestAnimationFrame(() => {
        window.scrollTo(0, savedState.scrollY);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSearch = useCallback(() => {
    setSearch('');
    if (searchRef.current) searchRef.current.blur();
  }, []);

  useEffect(() => {
    let frame = 0;

    const updateHeaderState = () => {
      frame = 0;
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
      setHeaderCompact(scrollY > 96);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateHeaderState);
    };

    updateHeaderState();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
    };
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleCategoryClick = (cat) => {
    setActiveCategory(cat);
    setActiveSubCategory('Всі');
  };

  // Зберегти стан і перейти до товару
  const handleProductClick = useCallback((product) => {
    onSaveState?.({
      scrollY: window.scrollY,
      activeCategory,
      activeSubCategory,
    });
    onProductClick(product);
  }, [onProductClick, onSaveState, activeCategory, activeSubCategory]);

  const subCategories = useMemo(() => {
    if (activeCategory === 'Всі') return [];
    const subset = products.filter((p) => p.category === activeCategory);
    const unique = [...new Set(subset.map((p) => p.p_category).filter(Boolean))].sort();
    return unique;
  }, [products, activeCategory]);

  const allSubCategories = useMemo(() => {
    if (subCategories.length === 0) return [];
    return ['Всі', ...subCategories];
  }, [subCategories]);

  const filtered = useMemo(() => {
    let result = products;

    if (search.trim()) {
      const words = search.toLowerCase().trim().split(/\s+/);
      result = result.filter((p) => {
        const haystack = `${p.name || ''} ${p.sku || ''} ${p.category || ''} ${p.p_category || ''}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
    } else {
      if (activeCategory !== 'Всі') {
        result = result.filter((p) => p.category === activeCategory);
      }

      if (activeCategory !== 'Всі' && activeSubCategory !== 'Всі') {
        result = result.filter((p) => p.p_category === activeSubCategory);
      }
    }

    return result;
  }, [products, activeCategory, activeSubCategory, search]);

  const allCategories = useMemo(() => ['Всі', ...categories], [categories]);

  return (
    <div>
      {/* Header */}
      <div className={`header catalog-header ${headerCompact ? 'catalog-header--compact' : ''}`}>
        <div className={`catalog-search-row ${isAdmin ? 'catalog-search-row--admin' : ''}`}>
          {onLogout && (
            <div className="catalog-user-session">
              <button
                type="button"
                className="catalog-logout-btn"
                aria-label="Вийти"
                title="Вийти"
                {...bindSingleTap(onLogout, { preventDefault: true })}
              >
                <LogoutIcon />
              </button>
              {userName && <span className="catalog-user-name">{userName}</span>}
            </div>
          )}
          {isAdmin && (
            <div className="catalog-admin-shortcuts" aria-label="Швидкі дії адміна">
              {adminShortcuts.map((shortcut) => (
                <button
                  key={shortcut.section}
                  type="button"
                  className="catalog-search-admin-btn"
                  aria-label={shortcut.label}
                  title={shortcut.label}
                  {...bindSingleTap(() => onAdminClick(shortcut.section), { preventDefault: true })}
                >
                  <AdminShortcutIcon icon={shortcut.icon} />
                </button>
              ))}
            </div>
          )}
          <div className="search-wrap catalog-search-wrap">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              className="search-input"
              type="text"
              inputMode="search"
              placeholder="Пошук товарів…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Очистити пошук"
                {...bindSingleTap(clearSearch, { preventDefault: true })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        className={`scroll-top-fab ${headerCompact ? 'is-active' : ''}`}
        aria-label="Повернутися на початок"
        aria-hidden={!headerCompact}
        tabIndex={headerCompact ? 0 : -1}
        {...bindSingleTap(scrollToTop, { preventDefault: true })}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>

      {/* Категорії */}
      <div className="categories-scroll">
        {allCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`category-chip ${activeCategory === cat ? 'active' : ''}`}
            style={getBrandStyle(cat, brandColors, defaultBrandColor)}
            {...bindSingleTap(() => handleCategoryClick(cat), { preventDefault: true })}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Підкатегорії */}
      {activeCategory !== 'Всі' && allSubCategories.length > 1 && (
        <div className="categories-scroll" style={{ paddingTop: 4, paddingBottom: 12 }}>
          {allSubCategories.map((sub) => (
            <button
              key={sub}
              type="button"
              className={`category-chip ${activeSubCategory === sub ? 'active' : ''}`}
              {...bindSingleTap(() => setActiveSubCategory(sub), { preventDefault: true })}
              style={{
                ...getBrandStyle(activeCategory, brandColors, defaultBrandColor),
                ...(activeSubCategory === sub ? {} : { background: 'rgba(255,255,255,0.5)', borderColor: 'rgba(14,165,233,0.1)' }),
              }}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      {/* Товари */}
      {loading ? (
        <div className="loading-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-img" />
              <div className="skeleton-body">
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="no-results" style={{ paddingTop: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <div style={{ maxWidth: 420, margin: '0 auto' }}>{error}</div>
        </div>
      ) : (
        <div className="product-grid">
          {filtered.length === 0 && (
            <div className="no-results">
              <div style={{ fontSize: 40, marginBottom: 8 }}>🔍</div>
              Нічого не знайдено
            </div>
          )}

          {filtered.map((product, idx) => {
            const qty = cart?.find(c => c.id === product.id)?.qty || 0;
            return (
              <article
                key={product.id}
                className={`product-card ${qty > 0 ? 'product-card--in-cart' : ''}`}
                style={{
                  ...getBrandStyle(product.category, brandColors, defaultBrandColor),
                  animationDelay: `${idx * 0.05}s`,
                }}
              >
                {qty > 0 && (
                  <div className="product-card-cart-mark" aria-label={`У кошику ${qty}`}>
                    {qty}
                  </div>
                )}
                <ProductCard product={product} onProductClick={handleProductClick}>
                  <div className="product-card-imgwrap">
                    {product.badge && String(product.badge).trim().toUpperCase() !== 'NULL' && (
                      <span className={`product-badge ${getBadgeClass(product.badge)}`}>
                        {product.badge}
                      </span>
                    )}
                    <SafeImage
                      className="product-card-img"
                      placeholderClassName="product-card-img-placeholder"
                      src={product.thumbnail_url}
                      alt={product.name}
                      loading={idx < 6 ? 'eager' : 'lazy'}
                      fetchPriority={idx < 4 ? 'high' : 'auto'}
                    />
                  </div>

                  <div className="product-card-body">
                    <div className="product-card-name">{product.name}</div>
                    {product.sku && String(product.sku).trim().toUpperCase() !== 'NULL' && (
                      <div className="product-card-category" style={{ marginBottom: 2 }}>{product.sku}</div>
                    )}
                    <div className="product-card-category">
                      {product.p_category || product.category}
                    </div>
                  </div>
                </ProductCard>

                <div className="product-card-footer">
                  <div className="product-card-price">
                    {formatPrice(product.price)}
                  </div>
                  <div className={`catalog-qty-controls ${qty === 0 ? 'catalog-qty-controls--empty' : ''}`}>
                    <button
                      type="button"
                      className="catalog-qty-btn catalog-qty-minus"
                      aria-label={`Зменшити кількість ${product.name}`}
                      disabled={qty === 0}
                      {...bindSingleTap(() => onUpdateQty(product.id, -1), {
                        preventDefault: false,
                      })}
                    >
                      −
                    </button>
                    <span
                      className={`catalog-qty-value ${qty === 0 ? 'catalog-qty-value--empty' : ''}`}
                      aria-hidden={qty === 0}
                    >
                      {qty > 0 ? qty : ''}
                    </span>
                    <button
                      type="button"
                      className="catalog-qty-btn catalog-qty-plus"
                      aria-label={qty === 0 ? `Додати ${product.name} в кошик` : `Збільшити кількість ${product.name}`}
                      {...bindSingleTap(() => qty === 0 ? onAddToCart(product) : onUpdateQty(product.id, 1), {
                        preventDefault: false,
                      })}
                    >
                      +
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* FAB кошика */}
      {cartCount > 0 && (
        <button
          type="button"
          className="cart-fab"
          aria-label="Відкрити кошик"
          {...bindSingleTap(onCartClick, { preventDefault: true })}
        >
          <div className="cart-fab-left">
            <span className="cart-fab-count">{cartCount}</span>
            <span>Кошик</span>
          </div>
          <div>{formatPrice(cartTotal)} ₴</div>
        </button>
      )}
    </div>
  );
}
