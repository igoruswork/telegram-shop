import { useCallback, useRef } from 'react';

export function useSingleTap(delay = 500) {
  const lastTouchTimeRef = useRef(0);

  return useCallback(
    (handler, options = {}) => {
      const { preventDefault = false, stopPropagation = false } = options;

      const touchEnd = (event) => {
        if (preventDefault) event.preventDefault();
        if (stopPropagation) event.stopPropagation();
        lastTouchTimeRef.current = Date.now();
        handler(event);
      };

      const click = (event) => {
        if (stopPropagation) event.stopPropagation();
        if (Date.now() - lastTouchTimeRef.current < delay) return;
        handler(event);
      };

      return {
        onTouchEnd: touchEnd,
        onClick: click,
      };
    },
    [delay]
  );
}
