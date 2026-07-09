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

  if (message.includes('Failed to send a request to the Edge Function')) {
    return `${fallback} Edge Function import-product-image не відповідає. Задеплойте її в Supabase Functions і перевірте SUPABASE_SERVICE_ROLE_KEY.`;
  }

  if (message.includes('relation') && message.includes('does not exist')) {
    return 'У Supabase немає потрібних таблиць. Запустіть SQL-скрипт для створення products, orders та access_log.';
  }

  if (message) {
    return `${fallback} ${message}`;
  }

  return fallback;
}

function isMissingAppSettingsTable(error) {
  const message = error?.message || '';
  return (
    error?.code === '42P01' ||
    (message.includes('relation') && message.includes('app_settings') && message.includes('does not exist'))
  );
}

// ─── API ФУНКЦІЇ ───────────────────────────────────────────────

const APP_SETTINGS_KEY = 'catalog';
const PRODUCT_IMAGE_BUCKET = 'product-images';
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function sanitizeStorageSegment(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return cleaned || fallback;
}

function extensionFromFile(file) {
  const nameExtension = String(file?.name || '').split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(nameExtension)) {
    return nameExtension === 'jpeg' ? 'jpg' : nameExtension;
  }

  const type = String(file?.type || '').toLowerCase();
  if (type.includes('webp')) return 'webp';
  if (type.includes('png')) return 'png';
  if (type.includes('gif')) return 'gif';
  if (type.includes('avif')) return 'avif';
  return 'jpg';
}

export async function fetchAppSettings() {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', APP_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingAppSettingsTable(error)) {
      console.warn('app_settings table is missing. Run the app settings migration.');
      return null;
    }

    console.error('fetchAppSettings error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити налаштування каталогу.'));
  }

  return data?.value || null;
}

export async function saveAppSettings(value) {
  ensureSupabaseConfigured();

  const { error } = await supabase
    .from('app_settings')
    .upsert(
      {
        key: APP_SETTINGS_KEY,
        value,
      },
      { onConflict: 'key' }
    );

  if (error) {
    console.error('saveAppSettings error:', error);
    throw new Error(toReadableError(error, 'Не вдалося зберегти налаштування каталогу.'));
  }
}

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
 * Знайти останнє ім'я та прізвище для телефону в access_log
 */
export async function fetchLatestAccessByPhone(phone) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('access_log')
    .select('phone, last_name, created_at')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('fetchLatestAccessByPhone error:', error);
    throw new Error(toReadableError(error, 'Не вдалося знайти попередній вхід.'));
  }

  return data;
}

/**
 * Знайти останнє ім'я та прізвище за початком номера.
 * Використовується для ранньої підказки, поки користувач вводить останні цифри.
 */
export async function fetchLatestAccessByPhonePrefix(phonePrefix) {
  ensureSupabaseConfigured();

  const prefix = String(phonePrefix || '').trim();
  if (!prefix) return null;

  const { data, error } = await supabase
    .from('access_log')
    .select('phone, last_name, created_at')
    .like('phone', `${prefix}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('fetchLatestAccessByPhonePrefix error:', error);
    throw new Error(toReadableError(error, 'Не вдалося знайти попередній вхід.'));
  }

  return data;
}

/**
 * Отримати останні входи в застосунок для адмін-панелі
 */
export async function fetchAccessLogEntries(limit = 100) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('access_log')
    .select('id, phone, last_name, tg_user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('fetchAccessLogEntries error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити входи.'));
  }

  return data || [];
}

/**
 * Отримати останні замовлення для адмін-панелі
 */
export async function fetchAdminOrders(limit = 100) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('orders')
    .select('id, phone, last_name, tg_user_id, tg_username, items, total, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('fetchAdminOrders error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити замовлення.'));
  }

  return data || [];
}

/**
 * Отримати ВСІ товари (включаючи view = false) — для адміна
 */
export async function fetchAllProducts() {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, p_category, badge, view, number_sites, sku, price, thumbnail_url')
    .order('number_sites', { ascending: true });

  if (error) {
    console.error('fetchAllProducts error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити всі товари.'));
  }
  return data || [];
}

/**
 * Оновити поля товару (для адміна)
 */
export async function updateProduct(id, fields) {
  ensureSupabaseConfigured();

  const { error } = await supabase
    .from('products')
    .update(fields)
    .eq('id', id);

  if (error) {
    console.error('updateProduct error:', error);
    throw new Error(toReadableError(error, 'Не вдалося оновити товар.'));
  }
}

/**
 * Створити новий товар (для адміна)
 */
export async function createProduct(fields) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('products')
    .insert(fields)
    .select('id, name, category, p_category, badge, view, number_sites, sku, price, thumbnail_url')
    .single();

  if (error) {
    console.error('createProduct error:', error);
    throw new Error(toReadableError(error, 'Не вдалося створити товар.'));
  }

  return data;
}

export async function fetchProductImageSource(product) {
  ensureSupabaseConfigured();

  const fallback = product?.source_thumbnail_url || product?.thumbnail_url || '';
  if (!product?.id) return fallback;

  const { data, error } = await supabase
    .from('products')
    .select('thumbnail_url, source_thumbnail_url')
    .eq('id', product.id)
    .maybeSingle();

  if (error) {
    if (error.code === '42703' || error.message?.includes('source_thumbnail_url')) {
      return fallback;
    }

    console.error('fetchProductImageSource error:', error);
    throw new Error(toReadableError(error, 'Не вдалося отримати URL картинки.'));
  }

  return data?.source_thumbnail_url || data?.thumbnail_url || fallback;
}

/**
 * Імпортувати зображення товару у Supabase Storage через Edge Function.
 * Якщо функція ще не задеплоєна, виклик має бути non-blocking на рівні UI.
 */
export async function importProductImage({ productId, sourceUrl, sku, name }) {
  ensureSupabaseConfigured();

  if (!productId || !sourceUrl) return null;

  const { data, error } = await supabase.functions.invoke('import-product-image', {
    body: {
      productId,
      sourceUrl,
      sku,
      name,
    },
  });

  if (error) {
    throw new Error(toReadableError(error, 'Не вдалося імпортувати картинку товару.'));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

/**
 * Завантажити локальний файл картинки з адмінки напряму в Supabase Storage.
 * Потребує bucket product-images і RLS policies з products admin migration.
 */
export async function uploadProductImageFile({ productId, file, sku, name, sourceUrl }) {
  ensureSupabaseConfigured();

  if (!productId || !file) return null;

  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Оберіть файл картинки.');
  }

  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error('Картинка завелика. Максимум 5 МБ.');
  }

  const ext = extensionFromFile(file);
  const skuSegment = sanitizeStorageSegment(sku, String(productId));
  const storagePath = `products/${skuSegment}-${productId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      cacheControl: '31536000',
      upsert: false,
    });

  if (uploadError) {
    console.error('uploadProductImageFile upload error:', uploadError);
    throw new Error(toReadableError(uploadError, 'Не вдалося завантажити фото в Storage.'));
  }

  const { data: publicData } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;

  const fields = {
    thumbnail_url: publicUrl,
    source_thumbnail_url: sourceUrl || publicUrl,
    image_storage_path: storagePath,
    image_status: 'ok',
    image_checked_at: new Date().toISOString(),
  };

  const { data: product, error: updateError } = await supabase
    .from('products')
    .update(fields)
    .eq('id', productId)
    .select('id, name, category, p_category, badge, view, number_sites, sku, price, thumbnail_url')
    .single();

  if (updateError) {
    console.error('uploadProductImageFile update error:', updateError);
    throw new Error(toReadableError(updateError, 'Фото завантажено, але товар не оновився.'));
  }

  return {
    product,
    source_thumbnail_url: fields.source_thumbnail_url,
    image_storage_path: storagePath,
  };
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

export function subscribeToAppSettings(callback) {
  if (supabaseConfigError) {
    return () => {};
  }

  const channel = supabase
    .channel('app-settings-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${APP_SETTINGS_KEY}` },
      (payload) => {
        callback(payload.new?.value || null);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
