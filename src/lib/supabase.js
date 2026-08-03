import { createClient } from '@supabase/supabase-js';
import { optimizeProductImageFile } from './productImageOptimizer';

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

function isMissingCatalogUsersTable(error) {
  const message = error?.message || '';
  return (
    error?.code === '42P01' ||
    (message.includes('relation') && message.includes('catalog_users') && message.includes('does not exist'))
  );
}

// ─── API ФУНКЦІЇ ───────────────────────────────────────────────

const APP_SETTINGS_KEY = 'catalog';
const PRODUCT_IMAGE_BUCKET = 'product-images';
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const PRODUCT_IMAGE_RENDER_WIDTH = 640;
const PRODUCT_IMAGE_RENDER_QUALITY = 78;

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

function buildOptimizedStorageImageUrl(storagePath) {
  if (!url || !storagePath) return '';

  const baseUrl = url.replace(/\/+$/, '');
  const encodedBucket = encodeURIComponent(PRODUCT_IMAGE_BUCKET);
  const encodedPath = String(storagePath).split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams({
    width: String(PRODUCT_IMAGE_RENDER_WIDTH),
    resize: 'contain',
    quality: String(PRODUCT_IMAGE_RENDER_QUALITY),
  });

  return `${baseUrl}/storage/v1/render/image/public/${encodedBucket}/${encodedPath}?${params.toString()}`;
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

async function requestLegacyCatalogAccess({ phone, lastName, tgUserId }) {
  await logAccess({ phone, lastName, tgUserId });

  return {
    phone,
    last_name: lastName,
    // Compatibility path for the short period between frontend and SQL deploy.
    // The new approval flow is enforced as soon as catalog_users exists.
    is_approved: true,
  };
}

/**
 * Keep event history separately from the current catalog user.
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
    throw new Error(toReadableError(error, 'Не вдалося записати вхід у журнал.'));
  }
}

/**
 * Register a catalog visitor once per phone. Approval is intentionally omitted
 * from the upsert payload, so a new access request can never self-approve.
 */
export async function requestCatalogAccess({ phone, lastName, tgUserId }) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('catalog_users')
    .upsert(
      {
        phone,
        last_name: lastName,
        tg_user_id: tgUserId || null,
        last_access_at: new Date().toISOString(),
      },
      { onConflict: 'phone' }
    )
    .select('phone, last_name, is_approved, last_access_at')
    .single();

  if (error) {
    if (isMissingCatalogUsersTable(error)) {
      console.warn('catalog_users is missing; using the temporary access_log compatibility path.');
      return requestLegacyCatalogAccess({ phone, lastName, tgUserId });
    }

    console.error('requestCatalogAccess error:', error);
    throw new Error(toReadableError(error, 'Не вдалося надіслати запит на доступ.'));
  }

  await logAccess({
    phone: data.phone,
    lastName: data.last_name || lastName,
    tgUserId,
  });

  return data;
}

export async function fetchCatalogUserAccess(phone) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('catalog_users')
    .select('phone, last_name, is_approved, last_access_at')
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    if (isMissingCatalogUsersTable(error)) {
      console.warn('catalog_users is missing; stored access will be rechecked after migration.');
      return null;
    }

    console.error('fetchCatalogUserAccess error:', error);
    throw new Error(toReadableError(error, 'Не вдалося перевірити доступ.'));
  }

  return data;
}

export async function fetchCatalogUsers(limit = 100) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('catalog_users')
    .select('phone, last_name, tg_user_id, is_approved, created_at, updated_at, last_access_at')
    .order('last_access_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('fetchCatalogUsers error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити користувачів.'));
  }

  return data || [];
}

export async function updateCatalogUserApproval(phone, isApproved) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('catalog_users')
    .update({ is_approved: Boolean(isApproved) })
    .eq('phone', phone)
    .select('phone, last_name, tg_user_id, is_approved, created_at, updated_at, last_access_at')
    .single();

  if (error) {
    console.error('updateCatalogUserApproval error:', error);
    throw new Error(toReadableError(error, 'Не вдалося змінити доступ користувача.'));
  }

  return data;
}

export async function updateCatalogUserName(phone, lastName) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('catalog_users')
    .update({ last_name: String(lastName || '').trim() })
    .eq('phone', phone)
    .select('phone, last_name, tg_user_id, is_approved, created_at, updated_at, last_access_at')
    .single();

  if (error) {
    console.error('updateCatalogUserName error:', error);
    throw new Error(toReadableError(error, 'Не вдалося змінити ім’я користувача.'));
  }

  return data;
}

export async function fetchAccessLogEntries(limit = 300) {
  ensureSupabaseConfigured();

  const { data, error } = await supabase
    .from('access_log')
    .select('id, phone, last_name, tg_user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('fetchAccessLogEntries error:', error);
    throw new Error(toReadableError(error, 'Не вдалося завантажити журнал входів.'));
  }

  return data || [];
}

export async function deleteAccessLogEntry(id) {
  ensureSupabaseConfigured();

  const { error } = await supabase
    .from('access_log')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('deleteAccessLogEntry error:', error);
    throw new Error(toReadableError(error, 'Не вдалося видалити запис журналу.'));
  }
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

  if (file.size > PRODUCT_IMAGE_SOURCE_MAX_BYTES) {
    throw new Error('Картинка завелика. Максимум 15 МБ.');
  }

  const uploadFile = await optimizeProductImageFile(file);

  if (uploadFile.size > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error('Картинка завелика після оптимізації. Максимум 5 МБ.');
  }

  const ext = extensionFromFile(uploadFile);
  const skuSegment = sanitizeStorageSegment(sku, String(productId));
  const storagePath = `products/${skuSegment}-${productId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(storagePath, uploadFile, {
      contentType: uploadFile.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      cacheControl: '31536000',
      upsert: false,
    });

  if (uploadError) {
    console.error('uploadProductImageFile upload error:', uploadError);
    throw new Error(toReadableError(uploadError, 'Не вдалося завантажити фото в Storage.'));
  }

  const publicUrl = buildOptimizedStorageImageUrl(storagePath) ||
    supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;

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
      (payload) => {
        callback(payload);
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
