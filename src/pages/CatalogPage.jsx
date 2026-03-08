import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useSingleTap } from '../lib/useSingleTap';
import { ProductCard } from '../components/ProductCard';

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
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Всі');
  const [activeSubCategory, setActiveSubCategory] = useState('Всі');
  const bindSingleTap = useSingleTap();
  const searchRef = useRef(null);

  const clearSearch = useCallback(() => {
    setSearch('');
    // Blur input to hide keyboard on mobile
    if (searchRef.current) searchRef.current.blur();
  }, []);

  const handleCategoryClick = (cat) => {
    setActiveCategory(cat);
    setActiveSubCategory('Всі'); // Скидаємо підкатегорію при зміні категорії
  };

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

  // Фільтрація — дані приходять з Supabase через props
  const filtered = useMemo(() => {
    let result = products;

    // Якщо є пошук — шукаємо по ВСІХ товарах (ігноруємо категорію)
    if (search.trim()) {
      const words = search.toLowerCase().trim().split(/\s+/);
      result = result.filter((p) => {
        const haystack = `${p.name || ''} ${p.sku || ''} ${p.category || ''} ${p.p_category || ''}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
    } else {
      // Фільтрація за категоріями тільки коли немає пошуку
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
      <div className="header">
        <div className="header-row">
          <div className="header-title">Каталог</div>
          <button
            type="button"
            className="header-cart-btn"
            aria-label="Відкрити кошик"
            {...bindSingleTap(onCartClick, { preventDefault: true })}
          >
            <svg className="cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
        </div>

        <div className="search-wrap">
          <span className="search-icon">🔍</span>
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
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Категорії — з Supabase */}
      <div className="categories-scroll">
        {allCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`category-chip ${activeCategory === cat ? 'active' : ''}`}
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
              style={activeSubCategory === sub ? {} : { background: 'rgba(255,255,255,0.5)', borderColor: 'rgba(14,165,233,0.1)' }}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      {/* Товари — з Supabase */}
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
                className="product-card"
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                <ProductCard product={product} onProductClick={onProductClick}>
                  <div className="product-card-imgwrap">
                    {product.badge && String(product.badge).trim().toUpperCase() !== 'NULL' && (
                      <span className={`product-badge ${getBadgeClass(product.badge)}`}>
                        {product.badge}
                      </span>
                    )}
                    {product.thumbnail_url ? (
                      <img
                        className="product-card-img"
                        src={product.thumbnail_url}
                        alt={product.name}
                        loading="lazy"
                      />
                    ) : (
                      <div className="product-card-img-placeholder">📦</div>
                    )}
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
                  <div className="catalog-qty-controls">
                    <button
                      type="button"
                      className="catalog-qty-btn catalog-qty-minus"
                      aria-label={`Зменшити кількість ${product.name}`}
                      disabled={qty === 0}
                      {...bindSingleTap(() => onUpdateQty(product.id, -1), {
                        preventDefault: true,
                      })}
                    >
                      −
                    </button>
                    <span className="catalog-qty-value">{qty}</span>
                    <button
                      type="button"
                      className="catalog-qty-btn catalog-qty-plus"
                      aria-label={qty === 0 ? `Додати ${product.name} в кошик` : `Збільшити кількість ${product.name}`}
                      {...bindSingleTap(() => qty === 0 ? onAddToCart(product) : onUpdateQty(product.id, 1), {
                        preventDefault: true,
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
