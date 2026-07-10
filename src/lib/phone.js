export const PHONE_PREFIX = '+380';
export const PHONE_DIGITS_COUNT = 12;
export const PHONE_PATTERN = /^\+380\d{9}$/;
export const EARLY_LOOKUP_NATIONAL_DIGITS = 5;

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

export function getNationalDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('380') ? digits.slice(3) : digits;
}

export function getEarlyPhoneLookupPrefix(value) {
  const nationalDigits = getNationalDigits(value);
  if (nationalDigits.length < EARLY_LOOKUP_NATIONAL_DIGITS) return '';

  return `${PHONE_PREFIX}${nationalDigits.slice(0, EARLY_LOOKUP_NATIONAL_DIGITS)}`;
}
