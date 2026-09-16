export function productDisplayText(value, fallback = '') {
  const text = String(value ?? '').trim();
  const normalized = text.toLowerCase();

  if (!text || normalized === 'null' || normalized === 'undefined') {
    return fallback;
  }

  return text;
}

/**
 * Keep the standard badge values in English in both the UI and database.
 * Older Ukrainian values remain readable and are normalized on the next save.
 */
export function normalizeProductBadge(value) {
  const text = productDisplayText(value);

  if (/^(скоро[.\s…]*|coming\s+soon[.\s…]*)$/i.test(text)) return 'Coming soon';
  if (/^(хіт|hit)$/i.test(text)) return 'Hit';
  if (/^(новинка|new)$/i.test(text)) return 'New';
  if (/^(акція|sale)$/i.test(text)) return 'Sale';

  return text;
}

export function isComingSoon(product) {
  return normalizeProductBadge(product?.badge) === 'Coming soon';
}
