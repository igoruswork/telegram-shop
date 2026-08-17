export function productDisplayText(value, fallback = '') {
  const text = String(value ?? '').trim();
  const normalized = text.toLowerCase();

  if (!text || normalized === 'null' || normalized === 'undefined') {
    return fallback;
  }

  return text;
}
