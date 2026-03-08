import { useEffect, useMemo, useCallback } from 'react';

/**
 * Hook для роботи з Telegram WebApp API
 * Повертає user, haptic feedback, MainButton тощо
 */
export function useTelegram() {
  const tg = useMemo(() => window.Telegram?.WebApp, []);

  useEffect(() => {
    if (!tg) return;
    tg.ready();
    tg.expand();
    // Disable Telegram's vertical swipe-to-close gesture —
    // it intercepts the first tap on page elements
    try { tg.disableVerticalSwipes(); } catch {}
    try { tg.enableClosingConfirmation(); } catch {}
  }, [tg]);

  const user = tg?.initDataUnsafe?.user || null;

  const haptic = useCallback(
    (type = 'light') => {
      try { tg?.HapticFeedback?.impactOccurred(type); } catch {}
    },
    [tg]
  );

  const hapticNotification = useCallback(
    (type = 'success') => {
      try { tg?.HapticFeedback?.notificationOccurred(type); } catch {}
    },
    [tg]
  );

  const close = useCallback(() => {
    try { tg?.close(); } catch {}
  }, [tg]);

  return { tg, user, haptic, hapticNotification, close };
}
