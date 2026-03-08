import { useCallback, useRef, useEffect } from 'react';

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

/**
 * Single-tap hook that registers touchstart/touchmove as PASSIVE listeners.
 * This allows the browser to scroll immediately without waiting for JS.
 * Use this for large tappable areas (product cards) that sit inside scroll containers.
 *
 * Returns a ref callback - attach it to the element's ref prop.
 * Also returns onClick for desktop fallback.
 */
export function usePassiveSingleTap(handler) {
  const stateRef = useRef({ x: 0, y: 0, moved: false, handled: false });
  const handlerRef = useRef(handler);
  const elementRef = useRef(null);

  // Keep handler ref up to date
  handlerRef.current = handler;

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const onTouchStart = (e) => {
      const t = e.touches[0];
      stateRef.current = {
        x: t.clientX,
        y: t.clientY,
        moved: false,
        handled: false,
      };
    };

    const onTouchMove = (e) => {
      if (stateRef.current.moved) return;
      const t = e.touches[0];
      if (
        Math.abs(t.clientX - stateRef.current.x) > MOVE_THRESHOLD ||
        Math.abs(t.clientY - stateRef.current.y) > MOVE_THRESHOLD
      ) {
        stateRef.current.moved = true;
      }
    };

    const onTouchEnd = (e) => {
      if (stateRef.current.moved) return;
      e.preventDefault();
      stateRef.current.handled = true;
      handlerRef.current(e);
    };

    // Register touchstart and touchmove as PASSIVE — 
    // browser can start scrolling immediately
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const onClick = useCallback((e) => {
    if (stateRef.current.handled) {
      stateRef.current.handled = false;
      return;
    }
    handlerRef.current(e);
  }, []);

  const refCallback = useCallback((node) => {
    elementRef.current = node;
  }, []);

  return { ref: refCallback, onClick };
}
