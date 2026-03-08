import React, { useState, useMemo } from 'react';

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
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Всі');
  const [activeSubCategory, setActiveSubCategory] = useState('Всі');

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

    if (activeCategory !== 'Всі') {
      result = result.filter((p) => p.category === activeCategory);
    }

    if (activeCategory !== 'Всі' && activeSubCategory !== 'Всі') {
      result = result.filter((p) => p.p_category === activeSubCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (p) =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q) ||
          (p.p_category || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q)
      );
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
          <button className="header-cart-btn" onClick={onCartClick}>
            🛒
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
        </div>

        <div className="search-wrap">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            type="text"
            inputMode="search"
            placeholder="Пошук товарів…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Категорії — з Supabase */}
      <div className="categories-scroll">
        {allCategories.map((cat) => (
          <button
            key={cat}
            className={`category-chip ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => handleCategoryClick(cat)}
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
              className={`category-chip ${activeSubCategory === sub ? 'active' : ''}`}
              onClick={() => setActiveSubCategory(sub)}
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

          {filtered.map((product, idx) => (
            <div
              key={product.id}
              className="product-card"
              style={{ animationDelay: `${idx * 0.05}s` }}
              onClick={() => onProductClick(product)}
            >
              <div className="product-card-imgwrap">
                {product.badge && (
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
                <div className="product-card-category">
                  {product.p_category || product.category}
                </div>
                <div className="product-card-footer">
                  <div className="product-card-price">
                    {formatPrice(product.price)}{' '}
                    <span>₴</span>
                  </div>
                  <button
                    className="product-add-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToCart(product);
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FAB кошика */}
      {cartCount > 0 && (
        <button className="cart-fab" onClick={onCartClick}>
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
