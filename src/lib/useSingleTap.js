import { useCallback } from 'react';

/**
 * Simple single-tap hook for Telegram Mini App.
 *
 * Relies on `touch-action: manipulation` CSS (already applied globally)
 * to eliminate the 300ms click delay on mobile. This means a plain
 * `onClick` fires immediately on first tap — no pointer/touch hacks needed.
 */
export function useSingleTap() {
  return useCallback((handler, options = {}) => {
    const { preventDefault = false, stopPropagation = false } = options;

    return {
      onClick: (event) => {
        if (preventDefault) event.preventDefault();
        if (stopPropagation) event.stopPropagation();
        handler(event);
      },
    };
  }, []);
}
