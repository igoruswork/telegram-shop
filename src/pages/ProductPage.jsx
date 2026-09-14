import React, { useState, useEffect, useLayoutEffect } from 'react';
import { fetchProductById } from '../lib/supabase';
import { useSingleTap } from '../lib/useSingleTap';
import { productDisplayText, isComingSoon } from '../lib/productDisplay';
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

export function ProductPage({ productId, initialProduct = null, onBack, onAddToCart }) {
  const [product, setProduct] = useState(initialProduct);
  const [loading, setLoading] = useState(() => !initialProduct);
  const [error, setError] = useState('');
  const bindSingleTap = useSingleTap();

  // The catalog and the product page share the document scroll container.
  // Reset it after this page has mounted, not only when the card is pressed:
  // on mobile the old scroll position can otherwise win the same-frame update.
  useLayoutEffect(() => {
    const scrollToTop = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    scrollToTop();
    const frame = window.requestAnimationFrame(scrollToTop);
    return () => window.cancelAnimationFrame(frame);
  }, [productId]);

  // Render the catalog snapshot immediately, then refresh it from Supabase.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setProduct(initialProduct);
      setLoading(!initialProduct);
      setError('');

      try {
        const data = await fetchProductById(productId);
        if (!cancelled) {
          setProduct(data);
        }
      } catch (err) {
        if (!cancelled) {
          if (!initialProduct) {
            setProduct(null);
            setError(err.message || 'Не вдалося завантажити товар.');
          } else {
            console.warn('product background refresh error:', err);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [initialProduct, productId]);

  if (loading) {
    return (
      <div className="product-page">
        <div className="product-page-header">
          <button
            type="button"
            className="back-btn"
            aria-label="Назад"
            {...bindSingleTap(onBack, { preventDefault: true })}
          >
            ←
          </button>
          <div className="product-page-title">Завантаження…</div>
        </div>
        <div className="skeleton-img" style={{ width: '100%', aspectRatio: '1' }} />
        <div style={{ padding: 20 }}>
          <div className="skeleton-line" style={{ height: 20, marginBottom: 12 }} />
          <div className="skeleton-line short" style={{ height: 14 }} />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="product-page">
        <div className="product-page-header">
          <button
            type="button"
            className="back-btn"
            aria-label="Назад"
            {...bindSingleTap(onBack, { preventDefault: true })}
          >
            ←
          </button>
          <div className="product-page-title">Товар не знайдено</div>
        </div>
        <div className="no-results" style={{ padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>😕</div>
          {error || 'Товар було видалено або приховано'}
        </div>
      </div>
    );
  }

  const soon = isComingSoon(product);
  const badge = soon ? 'Скоро..' : productDisplayText(product.badge);
  const sku = productDisplayText(product.sku);
  const category = productDisplayText(product.category);
  const subCategory = productDisplayText(product.p_category);

  return (
    <div className="product-page">
      <div className="product-page-header">
        <button
          type="button"
          className="back-btn"
          aria-label="Назад"
          {...bindSingleTap(onBack, { preventDefault: true })}
        >
          ←
        </button>
        <div className="product-page-title">{productDisplayText(product.name, 'Товар')}</div>
      </div>

      <SafeImage
        className="product-page-image"
        placeholderClassName="product-page-image-placeholder"
        src={product.thumbnail_url}
        alt={product.name}
        loading="eager"
        fetchPriority="high"
        sizes="100vw"
      />

      <div className="product-page-body">
        {badge && (
          <span className={`product-page-badge ${soon ? 'soon' : getBadgeClass(badge)}`}>
            {badge}
          </span>
        )}

        <h1 className="product-page-name">{productDisplayText(product.name, 'Товар')}</h1>

        {(category || subCategory) && (
          <div className="product-page-cat">
            {category}
            {category && subCategory ? ' → ' : ''}
            {subCategory}
          </div>
        )}

        {sku && (
          <div className="product-page-sku">Штрихкод: {sku}</div>
        )}

        {soon ? <div className="product-soon-panel"><span className="coming-soon-dot" /><div><strong>Незабаром у продажу</strong><p>Готуємо новинку для вас. Замовлення стане доступним після появи товару.</p></div></div> : <div className="product-page-price-row">
          <div className="product-page-price">
            {formatPrice(product.price)} <span>₴</span>
          </div>
          <button
            type="button"
            className="product-page-add-btn"
            {...bindSingleTap(() => onAddToCart(product), {
              preventDefault: true,
            })}
          >
            🛒 Додати в кошик
          </button>
        </div>}
      </div>
    </div>
  );
}
