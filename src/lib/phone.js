export const PHONE_PREFIX = '+380';
export const PHONE_DIGITS_COUNT = 12;
export const PHONE_PATTERN = /^\+380\d{9}$/;

export function normalizePhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  let nationalDigits = digits;

  if (digits.startsWith('380')) {
    nationalDigits = digits.slice(3);
  } else if (digits.startsWith('0')) {
    nationalDigits = digits.slice(1);
  }

  return `${PHONE_PREFIX}${nationalDigits.slice(0, PHONE_DIGITS_COUNT - 3)}`;
}

export function isPhoneComplete(value) {
  return PHONE_PATTERN.test(value);
}
