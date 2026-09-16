const priceFormatter = new Intl.NumberFormat('uk-UA');

export const formatPrice = (price) => priceFormatter.format(Number(price));
export const isHexColor = (value) => /^#[0-9a-fA-F]{6}$/.test(value || '');

export function hexToRgb(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ');
}

export function darkenHex(hex, amount = 0.34) {
  return `#${[1, 3, 5].map((index) => Math.max(0, Math.round(
    parseInt(hex.slice(index, index + 2), 16) * (1 - amount)
  )).toString(16).padStart(2, '0')).join('')}`;
}

export function getBrandStyle(category, brandColors, defaultBrandColor) {
  const color = brandColors?.[category] || defaultBrandColor;
  const validColor = isHexColor(color) ? color : defaultBrandColor;
  return {
    '--brand-color': validColor,
    '--brand-price-color': darkenHex(validColor),
    '--brand-rgb': hexToRgb(validColor),
  };
}

export function getBadgeClass(badge) {
  if (!badge) return '';
  const value = String(badge).toLowerCase();
  if (value.includes('хіт') || value.includes('hit')) return 'hit';
  if (value.includes('нов') || value.includes('new')) return 'new';
  if (value.includes('акц') || value.includes('sale')) return 'sale';
  return 'default';
}
