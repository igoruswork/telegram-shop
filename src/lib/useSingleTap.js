import { useCallback, useRef } from 'react';

const MOVE_THRESHOLD = 10;

/**
 * Robust single-tap hook for Telegram Mini App.
 *
 * Uses onTouchEnd for instant response on mobile (no 300ms delay).
 * Tracks finger movement to distinguish taps from scrolls.
 * Falls back to onClick for desktop/mouse users.
 *
 * IMPORTANT: Does NOT call e.preventDefault() — this was blocking
 * fling/inertial scrolling on Android Telegram WebView.
 * Instead uses a flag to suppress the duplicate click event.
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
        // Do NOT call e.preventDefault() — it blocks fling scroll on Android.
        if (stopPropagation) e.stopPropagation();
        stateRef.current.handled = true;
        handler(e);
      },
      onClick: (e) => {
        // On touch devices, handler already fired in onTouchEnd.
        // Suppress the follow-up click to prevent double invocation.
        if (stateRef.current.handled) {
          stateRef.current.handled = false;
          return;
        }
        // Desktop fallback
        if (stopPropagation) e.stopPropagation();
        handler(e);
      },
    };
  }, []);
}
