import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CatalogProductCard } from './CatalogProductCard';

const MOBILE_COLUMNS = 2;
const DESKTOP_COLUMNS = 5;
const MOBILE_GAP = 12;
const DESKTOP_GAP = 16;
const MOBILE_HORIZONTAL_PADDING = 32;
const DESKTOP_HORIZONTAL_PADDING = 48;
const OVERSCAN_ROWS = 4;

function getColumns() {
  return window.matchMedia('(min-width: 900px)').matches ? DESKTOP_COLUMNS : MOBILE_COLUMNS;
}

function getRowHeight(width, columns) {
  const desktop = columns === DESKTOP_COLUMNS;
  const gap = desktop ? DESKTOP_GAP : MOBILE_GAP;
  const horizontalPadding = desktop ? DESKTOP_HORIZONTAL_PADDING : MOBILE_HORIZONTAL_PADDING;
  const cardWidth = Math.max(120, (width - horizontalPadding - gap * (columns - 1)) / columns);
  // Image height + two lines of name/SKU/category + fixed quantity control.
  return Math.ceil(cardWidth / 1.22 + 158);
}

function splitIntoRows(products, columns) {
  const rows = [];
  for (let index = 0; index < products.length; index += columns) {
    rows.push(products.slice(index, index + columns));
  }
  return rows;
}

export function VirtualProductGrid({
  products,
  cartQtyByProductId,
  onProductClick,
  onAddToCart,
  onUpdateQty,
  brandColors,
  defaultBrandColor,
}) {
  const gridRef = useRef(null);
  const frameRef = useRef(0);
  const [columns, setColumns] = useState(() => getColumns());
  const [gridMetrics, setGridMetrics] = useState(() => ({ top: 0, width: window.innerWidth }));
  const [scrollY, setScrollY] = useState(() => window.scrollY);

  const rows = useMemo(() => splitIntoRows(products, columns), [products, columns]);
  const rowHeight = useMemo(() => getRowHeight(gridMetrics.width, columns), [gridMetrics.width, columns]);
  const totalHeight = rows.length * rowHeight;
  const viewportBottom = scrollY + window.innerHeight;
  const relativeTop = Math.max(0, scrollY - gridMetrics.top);
  const relativeBottom = Math.max(0, viewportBottom - gridMetrics.top);
  const startIndex = Math.max(0, Math.floor(relativeTop / rowHeight) - OVERSCAN_ROWS);
  const endIndex = Math.min(rows.length, Math.ceil(relativeBottom / rowHeight) + OVERSCAN_ROWS);
  const visibleRows = rows.slice(startIndex, endIndex);

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
      className="virtual-product-grid"
      style={{ '--virtual-row-height': `${rowHeight}px`, height: totalHeight }}
    >
      {visibleRows.map((row, visibleIndex) => {
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
