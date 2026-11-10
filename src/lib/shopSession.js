import { isPhoneComplete, normalizePhoneInput } from './phone.js';

export const USER_STORAGE_KEY = 'telegram-shop-user';

export function loadStoredUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const phone = normalizePhoneInput(parsed?.phone);
    const lastName = String(parsed?.lastName || parsed?.last_name || '').trim();

    if (!isPhoneComplete(phone) || !lastName) return null;

    return {
      phone,
      lastName,
    };
  } catch {
    return null;
  }
}
