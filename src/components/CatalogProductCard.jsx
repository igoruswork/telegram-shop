import { formatPrice, getBadgeClass, getBrandStyle } from '../lib/display';
import React, { useCallback, useMemo } from 'react';
import { SafeImage } from './SafeImage';
import { normalizeProductBadge, productDisplayText, isComingSoon } from '../lib/productDisplay';
import { getProductDiscountedPrice } from '../lib/brandDiscounts';

export const CatalogProductCard = React.memo(function CatalogProductCard({
  product,
  qty,
  onProductClick,
  onAddToCart,
  onUpdateQty,
  brandColors,
  brandDiscounts,
  defaultBrandColor,
  imagePriority = 'auto',
  cardStyle,
}) {
  const soon = isComingSoon(product);
  const price = getProductDiscountedPrice(product, brandDiscounts);
  const badge = normalizeProductBadge(product.badge);
  const sku = productDisplayText(product.sku);
  const category = productDisplayText(product.p_category) || productDisplayText(product.category);
  const brandStyle = useMemo(
    () => getBrandStyle(product.category, brandColors, defaultBrandColor),
    [brandColors, defaultBrandColor, product.category]
  );

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
      className={`product-card ${!soon && qty > 0 ? 'product-card--in-cart' : ''} ${soon ? 'product-card--soon' : ''}`}
      style={{ ...brandStyle, ...cardStyle }}
    >
      {!soon && qty > 0 && <div className="product-card-cart-mark" aria-label={`У кошику ${qty}`}>{qty}</div>}

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
            <span className={`product-badge ${soon ? 'soon' : getBadgeClass(badge)}`}>{badge}</span>
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

      {soon ? <div className="product-coming-soon"><span className="coming-soon-dot" />Незабаром у продажу</div> : <div className={`product-card-footer ${qty === 0 ? 'product-card-footer--empty' : ''}`}>
        <div className="product-card-price">{formatPrice(price)}</div>
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
      </div>}
    </article>
  );
});
