import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CatalogProductCard } from './CatalogProductCard';

const MOBILE_COLUMNS = 2;
const DESKTOP_COLUMNS = 5;
const MOBILE_GAP = 12;
const DESKTOP_GAP = 16;
const MOBILE_HORIZONTAL_PADDING = 32;
const DESKTOP_HORIZONTAL_PADDING = 48;
const OVERSCAN_ROWS = 4;
const MOBILE_INFO_CARD_HEIGHT = 108;
const MOBILE_INFO_CARD_EXPANDED_HEIGHT = 276;

function getColumns() {
  return window.matchMedia('(min-width: 900px)').matches ? DESKTOP_COLUMNS : MOBILE_COLUMNS;
}

function getRowHeight(width, columns) {
  const desktop = columns === DESKTOP_COLUMNS;
  const gap = desktop ? DESKTOP_GAP : MOBILE_GAP;
  const horizontalPadding = desktop ? DESKTOP_HORIZONTAL_PADDING : MOBILE_HORIZONTAL_PADDING;
  const cardWidth = Math.max(120, (width - horizontalPadding - gap * (columns - 1)) / columns);
  // Image height + two lines of name/SKU/category + fixed quantity control.
  const footerHeightAllowance = desktop ? 164 : 168;
  return Math.ceil(cardWidth / 1.22 + footerHeightAllowance);
}

function splitIntoRows(products, columns) {
  const rows = [];
  for (let index = 0; index < products.length; index += columns) {
    rows.push(products.slice(index, index + columns));
  }
  return rows;
}

function getVisibleRange(length, rowHeight, offset, relativeTop, relativeBottom) {
  const start = Math.max(0, Math.floor((relativeTop - offset) / rowHeight) - OVERSCAN_ROWS);
  const end = Math.min(length, Math.ceil((relativeBottom - offset) / rowHeight) + OVERSCAN_ROWS);

  return { start, end };
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

function getPaymentCardStyle(color) {
  const value = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#B8A477';
  const channels = [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
  const luminance = (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) / 255;

  return {
    '--payment-card-color': value,
    '--payment-card-rgb': channels.join(', '),
    '--payment-card-ink': luminance < 0.55 ? '#ffffff' : '#0f1b33',
  };
}

function PaymentCardMark() {
  return (
    <span className="catalog-info-card-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M16 26.5V14.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15.8 18.2C9.4 18.2 6.2 14 6.2 7.1c5.8 0 9.6 3.5 9.6 11.1Z" fill="currentColor" opacity=".82" />
        <path d="M16.2 18.2c6.4 0 9.6-4.2 9.6-11.1-5.8 0-9.6 3.5-9.6 11.1Z" fill="currentColor" opacity=".6" />
        <path d="M8.4 23.8h15.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function CopyIcon({ copied }) {
  if (copied) {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m5 12 4.2 4.2L19 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="10" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.5 8V6.3A2.3 2.3 0 0 0 13.2 4H6.3A2.3 2.3 0 0 0 4 6.3v8.9a2.3 2.3 0 0 0 2.3 2.3H8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CatalogInfoCard({
  details,
  iban,
  color,
  taxId,
  extraDetails,
  visibility,
  expanded,
  onToggle,
}) {
  const [copied, setCopied] = useState(false);
  const cardStyle = useMemo(() => getPaymentCardStyle(color), [color]);
  const showName = visibility?.name !== false && Boolean(details);
  const showIban = visibility?.iban !== false && Boolean(iban);
  const showTaxId = visibility?.taxId !== false && Boolean(taxId);
  const showExtraDetails = visibility?.extraDetails !== false && Boolean(extraDetails);
  const compactTitle = showName ? details : 'Реквізити';

  const handleCopy = async () => {
    if (!iban) return;

    try {
      await copyToClipboard(iban);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.warn('IBAN copy error:', error);
    }
  };

  return (
    <aside
      className={`catalog-info-card catalog-info-card--filled ${expanded ? 'catalog-info-card--expanded' : ''}`}
      style={cardStyle}
    >
      <button
        type="button"
        className="catalog-info-card-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <PaymentCardMark />
        <span className="catalog-info-card-head-copy">
          <span className="catalog-info-card-text">{compactTitle}</span>
          {showIban && <span className="catalog-info-card-compact-iban">{iban}</span>}
        </span>
      </button>

      {expanded && (
        <div className="catalog-info-card-expanded-body">
          {showName && (
            <div className="catalog-info-card-detail">
              <span>Одержувач</span>
              <strong>{details}</strong>
            </div>
          )}
          {showIban && (
            <button
              type="button"
              className="catalog-info-card-detail catalog-info-card-detail--copy"
              aria-label={copied ? 'IBAN скопійовано' : 'Скопіювати IBAN'}
              onClick={handleCopy}
            >
              <span>IBAN</span>
              <strong>
                {iban}
                <em
                  className={`catalog-info-card-copy-icon ${copied ? 'is-copied' : ''}`}
                  title={copied ? 'Скопійовано' : 'Скопіювати'}
                >
                  <CopyIcon copied={copied} />
                </em>
              </strong>
            </button>
          )}
          {showTaxId && (
            <div className="catalog-info-card-detail">
              <span>ІПН / ЄДРПОУ</span>
              <strong>{taxId}</strong>
            </div>
          )}
          {showExtraDetails && (
            <div className="catalog-info-card-detail catalog-info-card-detail--extra">
              <span>Додатково</span>
              <strong>{extraDetails}</strong>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

export function VirtualProductGrid({
  products,
  cartQtyByProductId,
  onProductClick,
  onAddToCart,
  onUpdateQty,
  brandColors,
  defaultBrandColor,
  paymentDetails,
  paymentIban,
  paymentCardColor,
  paymentTaxId,
  paymentExtraDetails,
  paymentCardVisibility,
}) {
  const gridRef = useRef(null);
  const frameRef = useRef(0);
  const [columns, setColumns] = useState(() => getColumns());
  const [gridMetrics, setGridMetrics] = useState(() => ({ top: 0, width: window.innerWidth }));
  const [scrollY, setScrollY] = useState(() => window.scrollY);
  const [paymentCardExpanded, setPaymentCardExpanded] = useState(false);

  const rows = useMemo(() => splitIntoRows(products, columns), [products, columns]);
  const mobileColumns = useMemo(() => ({
    left: products.filter((_, index) => index % MOBILE_COLUMNS === 1),
    right: products.filter((_, index) => index % MOBILE_COLUMNS === 0),
  }), [products]);
  const rowHeight = useMemo(() => getRowHeight(gridMetrics.width, columns), [gridMetrics.width, columns]);
  const viewportBottom = scrollY + window.innerHeight;
  const relativeTop = Math.max(0, scrollY - gridMetrics.top);
  const relativeBottom = Math.max(0, viewportBottom - gridMetrics.top);
  const mobileLayout = columns === MOBILE_COLUMNS;
  const paymentCardEnabled = paymentCardVisibility?.enabled !== false;
  const paymentCardIsExpanded = paymentCardEnabled && paymentCardExpanded;
  const mobileLeftOffset = paymentCardEnabled
    ? (paymentCardIsExpanded ? MOBILE_INFO_CARD_EXPANDED_HEIGHT : MOBILE_INFO_CARD_HEIGHT)
    : 0;
  const mobileRightOffset = paymentCardIsExpanded ? MOBILE_INFO_CARD_EXPANDED_HEIGHT : 0;
  const mobileLeftRange = getVisibleRange(
    mobileColumns.left.length,
    rowHeight,
    mobileLeftOffset,
    relativeTop,
    relativeBottom
  );
  const mobileRightRange = getVisibleRange(
    mobileColumns.right.length,
    rowHeight,
    mobileRightOffset,
    relativeTop,
    relativeBottom
  );
  const startIndex = Math.max(0, Math.floor(relativeTop / rowHeight) - OVERSCAN_ROWS);
  const endIndex = Math.min(rows.length, Math.ceil(relativeBottom / rowHeight) + OVERSCAN_ROWS);
  const visibleRows = rows.slice(startIndex, endIndex);
  const totalHeight = mobileLayout
    ? Math.max(
      mobileLeftOffset + mobileColumns.left.length * rowHeight,
      mobileRightOffset + mobileColumns.right.length * rowHeight
    )
    : rows.length * rowHeight;

  useLayoutEffect(() => {
    const updateMetrics = () => {
      const element = gridRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setGridMetrics({
        top: rect.top + window.scrollY,
        width: rect.width,
      });
    };

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    if (gridRef.current) observer.observe(gridRef.current);
    window.addEventListener('resize', updateMetrics);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [columns, products.length]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const updateColumns = () => setColumns(getColumns());
    media.addEventListener('change', updateColumns);
    return () => media.removeEventListener('change', updateColumns);
  }, []);

  useEffect(() => {
    const updateScroll = () => {
      if (frameRef.current) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        setScrollY(window.scrollY);
      });
    };

    updateScroll();
    window.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('resize', updateScroll);

    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      window.removeEventListener('scroll', updateScroll);
      window.removeEventListener('resize', updateScroll);
    };
  }, []);

  return (
    <div
      ref={gridRef}
      className={`virtual-product-grid ${mobileLayout ? 'virtual-product-grid--mobile' : ''}`}
      style={{ '--virtual-row-height': `${rowHeight}px`, height: totalHeight }}
    >
      {mobileLayout && (
        <>
          {paymentCardIsExpanded && (
            <CatalogInfoCard
              details={paymentDetails}
              iban={paymentIban}
              color={paymentCardColor}
              taxId={paymentTaxId}
              extraDetails={paymentExtraDetails}
              visibility={paymentCardVisibility}
              expanded
              onToggle={() => setPaymentCardExpanded(false)}
            />
          )}
          <div className="virtual-product-grid-mobile-column virtual-product-grid-mobile-column--left">
            {paymentCardEnabled && !paymentCardIsExpanded && (
              <CatalogInfoCard
                details={paymentDetails}
                iban={paymentIban}
                color={paymentCardColor}
                taxId={paymentTaxId}
                extraDetails={paymentExtraDetails}
                visibility={paymentCardVisibility}
                expanded={false}
                onToggle={() => setPaymentCardExpanded(true)}
              />
            )}
            {mobileColumns.left.slice(mobileLeftRange.start, mobileLeftRange.end).map((product, index) => {
              const productIndex = mobileLeftRange.start + index;

              return (
                <CatalogProductCard
                  key={product.id}
                  product={product}
                  qty={cartQtyByProductId.get(product.id) || 0}
                  onProductClick={onProductClick}
                  onAddToCart={onAddToCart}
                  onUpdateQty={onUpdateQty}
                  brandColors={brandColors}
                  defaultBrandColor={defaultBrandColor}
                  imagePriority={productIndex < 3 ? 'high' : 'auto'}
                  cardStyle={{ transform: `translateY(${mobileLeftOffset + productIndex * rowHeight}px)` }}
                />
              );
            })}
          </div>
          <div className="virtual-product-grid-mobile-column virtual-product-grid-mobile-column--right">
            {mobileColumns.right.slice(mobileRightRange.start, mobileRightRange.end).map((product, index) => {
              const productIndex = mobileRightRange.start + index;

              return (
                <CatalogProductCard
                  key={product.id}
                  product={product}
                  qty={cartQtyByProductId.get(product.id) || 0}
                  onProductClick={onProductClick}
                  onAddToCart={onAddToCart}
                  onUpdateQty={onUpdateQty}
                  brandColors={brandColors}
                  defaultBrandColor={defaultBrandColor}
                  imagePriority={productIndex < 3 ? 'high' : 'auto'}
                  cardStyle={{ transform: `translateY(${mobileRightOffset + productIndex * rowHeight}px)` }}
                />
              );
            })}
          </div>
        </>
      )}

      {!mobileLayout && visibleRows.map((row, visibleIndex) => {
        const rowIndex = startIndex + visibleIndex;
        return (
          <div
            key={row[0]?.id || rowIndex}
            className="virtual-product-grid-row"
            style={{ transform: `translateY(${rowIndex * rowHeight}px)` }}
          >
            {row.map((product, productIndex) => (
              <CatalogProductCard
                key={product.id}
                product={product}
                qty={cartQtyByProductId.get(product.id) || 0}
                onProductClick={onProductClick}
                onAddToCart={onAddToCart}
                onUpdateQty={onUpdateQty}
                brandColors={brandColors}
                defaultBrandColor={defaultBrandColor}
                imagePriority={rowIndex === 0 && productIndex < 4 ? 'high' : 'auto'}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
