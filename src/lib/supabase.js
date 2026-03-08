import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isSecretKey = typeof key === 'string' && key.startsWith('sb_secret_');

export const supabaseConfigError = (() => {
  if (!url || !key) {
    return 'Додайте VITE_SUPABASE_URL та VITE_SUPABASE_ANON_KEY в .env';
  }

  if (isSecretKey) {
    return 'У VITE_SUPABASE_ANON_KEY вказано secret key. Для фронтенду потрібен anon/public key із Supabase Settings -> API.';
  }

  return '';
})();

if (supabaseConfigError) {
  console.error(
    '❌ Supabase не налаштовано!\n' +
    supabaseConfigError
  );
}

export const supabase = createClient(url || '', key || '');

function ensureSupabaseConfigured() {
  if (supabaseConfigError) {
    throw new Error(supabaseConfigError);
  }
}

function toReadableError(error, fallback) {
  const message = error?.message || '';

  if (error?.code === '42501') {
    return 'Немає доступу до таблиці. Перевірте RLS policy для anon користувача в Supabase.';
  }

  if (message.includes('relation') && message.includes('does not exist')) {
    return 'У Supabase немає потрібних таблиць. Запустіть SQL-скрипт для створення products, orders та access_log.';
  }

  if (message) {
    return `${fallback} ${message}`;
  }

  return fallback;
}

// ─── API ФУНКЦІЇ ───────────────────────────────────────────────

/**
 * Отримати всі видимі товари (view = true), відсортовані по number_sites
 */
export async function fetchProducts() {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, p_category, badge, view, number_sites, sku, price, thumbnail_url')
    .eq('view', true)
    .order('number_sites', { ascending: true });

  if (error) {
    console.error('fetchProducts error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити товари з Supabase.'));
  }
  return data || [];
}

/**
 * Отримати один товар по ID (з бази, не з кешу)
 */
export async function fetchProductById(id) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('fetchProductById error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити товар.'));
  }
  return data;
}

/**
 * Отримати унікальні категорії видимих товарів
 */
export async function fetchCategories() {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('products')
    .select('category')
    .eq('view', true);

  if (error) {
    console.error('fetchCategories error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити категорії.'));
  }

  const unique = [...new Set((data || []).map((r) => r.category).filter(Boolean))].sort();
  return unique;
}

/**
 * Зберегти замовлення в Supabase
 */
export async function createOrder({ tgUserId, tgUsername, phone, lastName, items, total }) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('orders')
    .insert({
      tg_user_id: tgUserId || null,
      tg_username: tgUsername || '',
      phone: phone || '',
      last_name: lastName || '',
      items,
      total,
      status: 'new',
    })
    .select()
    .single();

  if (error) {
    console.error('createOrder error:', error);
    throw new Error(toReadableError(error, 'Не вдалося зберегти замовлення.'));
  }
  return data;
}

/**
 * Записати вхід відвідувача в access_log
 */
export async function logAccess({ phone, lastName, tgUserId }) {
  ensureSupabaseConfigured();

  const { error } = await supabase
    .from('access_log')
    .insert({
      phone,
      last_name: lastName,
      tg_user_id: tgUserId || null,
    });

  if (error) {
    console.error('logAccess error:', error);
    throw new Error(toReadableError(error, 'Не вдалося записати вхід користувача.'));
  }
}

/**
 * Підписатися на зміни таблиці products (Realtime)
 * Повертає функцію для відписки
 */
export function subscribeToProducts(callback) {
  const channel = supabase
    .channel('products-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      () => {
        // При будь-якій зміні — перезавантажити весь список
        callback();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
