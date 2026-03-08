import React from 'react';
import { usePassiveSingleTap } from '../lib/useSingleTap';

/**
 * Product card with passive touch listeners for smooth scrolling on Android.
 * Wraps the tappable area in a ref-based passive listener instead of
 * React's non-passive onTouchStart/onTouchMove.
 */
export function ProductCard({ product, onProductClick, children }) {
    const { ref, onClick } = usePassiveSingleTap(() => onProductClick(product));

    return (
        <button
            ref={ref}
            type="button"
            className="product-card-main"
            aria-label={`Відкрити товар ${product.name}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
