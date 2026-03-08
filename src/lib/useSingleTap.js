import { useCallback, useRef } from 'react';

const MOVE_THRESHOLD = 10;

/**
 * Robust single-tap hook for Telegram Mini App.
 *
 * Uses onTouchEnd for instant response on mobile (no 300ms delay).
 * Tracks finger movement to distinguish taps from scrolls.
 * Falls back to onClick for desktop/mouse users.
 */
export function useSingleTap() {
  const stateRef = useRef({ x: 0, y: 0, moved: false, handled: false });

  return useCallback((handler, options = {}) => {
    const { stopPropagation = false } = options;

    return {
      onTouchStart: (e) => {
        const t = e.touches[0];
        stateRef.current = {
          x: t.clientX,
          y: t.clientY,
          moved: false,
          handled: false,
        };
      },
      onTouchMove: (e) => {
        if (stateRef.current.moved) return;
        const t = e.touches[0];
        if (
          Math.abs(t.clientX - stateRef.current.x) > MOVE_THRESHOLD ||
          Math.abs(t.clientY - stateRef.current.y) > MOVE_THRESHOLD
        ) {
          stateRef.current.moved = true;
        }
      },
      onTouchEnd: (e) => {
        if (stateRef.current.moved) return;
        e.preventDefault(); // Prevent delayed click from firing
        if (stopPropagation) e.stopPropagation();
        stateRef.current.handled = true;
        handler(e);
      },
      onClick: (e) => {
        // Desktop fallback — on touch devices this is suppressed
        // by preventDefault in onTouchEnd
        if (stateRef.current.handled) {
          stateRef.current.handled = false;
          return;
        }
        if (stopPropagation) e.stopPropagation();
        handler(e);
      },
    };
  }, []);
}
