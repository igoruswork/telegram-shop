const DISCOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?%?$/;

/**
 * A brand in this catalog is stored as the product's `category`.
 * Discounts stay separate from a product price, so repricing can continue to
 * manage the full/base price while the customer always sees the final price.
 */
export function normalizeBrandDiscount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 100
      && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001
      ? value
      : null;
  }

  const text = String(value ?? '').trim();
  if (!DISCOUNT_PATTERN.test(text)) return null;

  return normalizeBrandDiscount(Number(text.replace('%', '').replace(',', '.')));
}

export function normalizeBrandDiscounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([brand, discount]) => {
      const key = String(brand || '').trim();
      const normalized = normalizeBrandDiscount(discount);
      return key && normalized !== null ? [[key, normalized]] : [];
    })
  );
}

export function getBrandDiscount(brandDiscounts, brand) {
  const key = String(brand || '').trim();
  return normalizeBrandDiscount(brandDiscounts?.[key]) ?? 0;
}

export function calculateDiscountedPrice(price, discount = 0) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return 0;

  const safeDiscount = normalizeBrandDiscount(discount) ?? 0;
  return Math.round((amount * (100 - safeDiscount) + Number.EPSILON)) / 100;
}

export function getProductDiscountedPrice(product, brandDiscounts) {
  return calculateDiscountedPrice(
    product?.price,
    getBrandDiscount(brandDiscounts, product?.category)
  );
}
