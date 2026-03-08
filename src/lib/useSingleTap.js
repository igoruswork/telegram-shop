import { useCallback, useRef } from 'react';

export function useSingleTap(delay = 500) {
  const lastPressTimeRef = useRef(0);

  return useCallback(
    (handler, options = {}) => {
      const { preventDefault = false, stopPropagation = false } = options;

      const runHandler = (event) => {
        if (preventDefault) event.preventDefault();
        if (stopPropagation) event.stopPropagation();
        lastPressTimeRef.current = Date.now();
        handler(event);
      };

      const pointerDown = (event) => {
        if (event.pointerType && event.pointerType !== 'mouse') {
          event.preventDefault();
        }
      };

      const pointerUp = (event) => {
        if (event.pointerType && event.pointerType !== 'mouse') {
          runHandler(event);
        }
      };

      const touchEnd = (event) => {
        runHandler(event);
      };

      const click = (event) => {
        if (Date.now() - lastPressTimeRef.current < delay) return;
        runHandler(event);
      };

      return {
        onPointerDown: pointerDown,
        onPointerUp: pointerUp,
        onTouchEnd: touchEnd,
        onClick: click,
      };
    },
    [delay]
  );
}
