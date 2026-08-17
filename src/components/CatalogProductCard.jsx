import React, { useCallback, useMemo } from 'react';
import { SafeImage } from './SafeImage';
import { productDisplayText } from '../lib/productDisplay';

function formatPrice(price) {
  return Number(price).toLocaleString('uk-UA');
}

function getBadgeClass(badge) {
  if (!badge) return '';
  const value = String(badge).toLowerCase();
  if (value.includes('хіт') || value.includes('hit')) return 'hit';
  if (value.includes('нов') || value.includes('new')) return 'new';
  if (value.includes('акц') || value.includes('sale')) return 'sale';
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
  return `#${[0, 2, 4]
    .map((index) => Math.max(0, Math.round(parseInt(value.slice(index, index + 2), 16) * (1 - amount))))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

export const CatalogProductCard = React.memo(function CatalogProductCard({
  product,
  qty,
  onProductClick,
  onAddToCart,
  onUpdateQty,
  brandColors,
  defaultBrandColor,
  imagePriority = 'auto',
  cardStyle,
}) {
  const badge = productDisplayText(product.badge);
  const sku = productDisplayText(product.sku);
  const category = productDisplayText(product.p_category) || productDisplayText(product.category);
  const brandStyle = useMemo(() => {
    const color = brandColors?.[product.category] || defaultBrandColor;
    const validColor = isHexColor(color) ? color : defaultBrandColor;

    return {
      '--brand-color': validColor,
      '--brand-price-color': darkenHex(validColor),
      '--brand-rgb': hexToRgb(validColor),
    };
  }, [brandColors, defaultBrandColor, product.category]);

  const openProduct = useCallback(() => onProductClick(product), [onProductClick, product]);
  const decreaseQty = useCallback(() => onUpdateQty(product.id, -1), [onUpdateQty, product.id]);
  const increaseQty = useCallback(() => {
    if (qty === 0) {
      onAddToCart(product);
      return;
    }
    onUpdateQty(product.id, 1);
  }, [onAddToCart, onUpdateQty, product, qty]);

  return (
    <article
      className={`product-card ${qty > 0 ? 'product-card--in-cart' : ''}`}
      style={{ ...brandStyle, ...cardStyle }}
    >
      {qty > 0 && <div className="product-card-cart-mark" aria-label={`У кошику ${qty}`}>{qty}</div>}

      <div
        role="button"
        tabIndex={0}
        className="product-card-main"
        aria-label={`Відкрити товар ${product.name}`}
        onClick={openProduct}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') openProduct();
        }}
      >
        <div className="product-card-imgwrap">
          {badge && (
            <span className={`product-badge ${getBadgeClass(badge)}`}>{badge}</span>
          )}
          <SafeImage
            className="product-card-img"
            placeholderClassName="product-card-img-placeholder"
            src={product.thumbnail_url}
            alt={product.name}
            sizes="(min-width: 900px) 20vw, 50vw"
            fetchPriority={imagePriority}
          />
        </div>

        <div className="product-card-body">
          <div className="product-card-name">{productDisplayText(product.name, 'Товар')}</div>
          {sku && (
            <div className="product-card-category product-card-sku">{sku}</div>
          )}
          {category && <div className="product-card-category">{category}</div>}
        </div>
      </div>

      <div className={`product-card-footer ${qty === 0 ? 'product-card-footer--empty' : ''}`}>
        <div className="product-card-price">{formatPrice(product.price)}</div>
        <div className={`catalog-qty-controls ${qty === 0 ? 'catalog-qty-controls--empty' : ''}`}>
          <button
            type="button"
            className="catalog-qty-btn catalog-qty-minus"
            aria-label={`Зменшити кількість ${product.name}`}
            disabled={qty === 0}
            onClick={decreaseQty}
          >
            −
          </button>
          <span className={`catalog-qty-value ${qty === 0 ? 'catalog-qty-value--empty' : ''}`} aria-hidden={qty === 0}>
            {qty > 0 ? qty : ''}
          </span>
          <button
            type="button"
            className="catalog-qty-btn catalog-qty-plus"
            aria-label={qty === 0 ? `Додати ${product.name} в кошик` : `Збільшити кількість ${product.name}`}
            onClick={increaseQty}
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
});
