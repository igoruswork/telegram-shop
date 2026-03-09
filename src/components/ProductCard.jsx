import React, { useCallback } from 'react';

/**
 * Product card — clickable area that opens product detail.
 *
 * Uses a plain <div role="button"> + onClick instead of <button> + touch events.
 * Reason: on Android Telegram WebView, <button> elements with touch listeners
 * capture touch gestures and block vertical scrolling of the parent container.
 * With modern viewport meta (maximum-scale=1), there is no 300ms click delay,
 * so onClick fires instantly — no need for custom touch handling.
 */
export function ProductCard({ product, onProductClick, children }) {
    const handleClick = useCallback(() => {
        onProductClick(product);
    }, [product, onProductClick]);

    return (
        <div
            role="button"
            tabIndex={0}
            className="product-card-main"
            aria-label={`Відкрити товар ${product.name}`}
            onClick={handleClick}
        >
            {children}
        </div>
    );
}
