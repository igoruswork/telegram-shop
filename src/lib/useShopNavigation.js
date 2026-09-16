import { useEffect, useState } from 'react';
import { createShopNavigation } from './shopNavigation';

export function useShopNavigation({ tg, enabled, onBack }) {
  const [navigation] = useState(() => createShopNavigation(window));
  const [route, setRoute] = useState(navigation.getState);

  useEffect(() => {
    const unsubscribe = navigation.subscribe(setRoute);
    const stop = navigation.start();
    return () => { stop(); unsubscribe(); };
  }, [navigation]);

  useEffect(() => {
    const button = tg?.BackButton;
    if (!button) return undefined;
    const visible = enabled && (route.page !== 'catalog' || route.cartOpen);
    const back = () => { onBack?.(); navigation.back(); };
    try {
      if (visible) button.show(); else button.hide();
      button.onClick(back);
    } catch { /* Older Telegram clients can use the in-page buttons. */ }
    return () => {
      try { button.offClick(back); button.hide(); } catch { /* Unsupported client. */ }
    };
  }, [enabled, navigation, onBack, route.cartOpen, route.page, tg]);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  return { ...route, navigation };
}
