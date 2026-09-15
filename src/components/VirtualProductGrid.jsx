import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CatalogProductCard } from './CatalogProductCard';
import { PaymentCard } from './PaymentCard';

const MOBILE_COLUMNS = 2;
const DESKTOP_COLUMNS = 5;
const MOBILE_GAP = 12;
const DESKTOP_GAP = 16;
const MOBILE_HORIZONTAL_PADDING = 32;
const DESKTOP_HORIZONTAL_PADDING = 48;
const OVERSCAN_ROWS = 4;
const MOBILE_INFO_CARD_HEIGHT = 124;
const MOBILE_INFO_CARD_EXPANDED_HEIGHT = 300;

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

export function VirtualProductGrid({
  products,
  cartQtyByProductId,
  onProductClick,
  onAddToCart,
  onUpdateQty,
  brandColors,
  brandDiscounts,
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
  const [expandedHeight, setExpandedHeight] = useState(MOBILE_INFO_CARD_EXPANDED_HEIGHT);

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
    ? (paymentCardIsExpanded ? expandedHeight : MOBILE_INFO_CARD_HEIGHT)
    : 0;
  const mobileRightOffset = paymentCardIsExpanded ? expandedHeight : 0;
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
            <PaymentCard
              details={paymentDetails}
              iban={paymentIban}
              color={paymentCardColor}
              taxId={paymentTaxId}
              extraDetails={paymentExtraDetails}
              visibility={paymentCardVisibility}
              expanded
              onHeightChange={setExpandedHeight}
              onToggle={() => setPaymentCardExpanded(false)}
            />
          )}
          <div className="virtual-product-grid-mobile-column virtual-product-grid-mobile-column--left">
            {paymentCardEnabled && !paymentCardIsExpanded && (
              <PaymentCard
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
                  brandDiscounts={brandDiscounts}
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
                  brandDiscounts={brandDiscounts}
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
                brandDiscounts={brandDiscounts}
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
