import { useCallback, useRef } from 'react';

const MOVE_THRESHOLD = 10;

/**
 * Robust single-tap hook for Telegram Mini App.
 *
 * Uses onTouchEnd for instant response on mobile (no 300ms delay).
 * Tracks finger movement to distinguish taps from scrolls.
 * Falls back to onClick for desktop/mouse users.
 *
 * Options:
 *   preventDefault (default: true)
 *     — calls e.preventDefault() in onTouchEnd to eliminate the 300ms
 *       click delay on older Android devices. Set to FALSE for buttons
 *       that live inside a scroll container (e.g. +/- qty buttons in
 *       the product grid) so that fling/inertial scrolling still works.
 *
 *   stopPropagation (default: false)
 *     — calls e.stopPropagation() in onTouchEnd and onClick.
 */
export function useSingleTap() {
  const stateRef = useRef({ x: 0, y: 0, moved: false, handled: false });

  return useCallback((handler, options = {}) => {
    const {
      preventDefault = true,
      stopPropagation = false,
    } = options;

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
        // preventDefault eliminates the 300ms click delay on older Android.
        // Disable it for buttons inside scroll containers to preserve fling.
        if (preventDefault) e.preventDefault();
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
