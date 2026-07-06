import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const retryBroken = args.includes('--retry-broken');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;
const bucket = process.env.PRODUCT_IMAGE_BUCKET || 'product-images';
const maxBytes = Number(process.env.PRODUCT_IMAGE_MAX_BYTES || 5 * 1024 * 1024);
const fetchTimeoutMs = Number(process.env.PRODUCT_IMAGE_FETCH_TIMEOUT_MS || 8000);
const concurrency = Math.max(1, Number(process.env.PRODUCT_IMAGE_CONCURRENCY || 8));

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index);
        const value = line.slice(index + 1).replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
  );
}

const env = {
  ...readEnvFile('.env.local'),
  ...readEnvFile('.env'),
  ...process.env,
};

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const readKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
const writeKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !readKey) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL and a Supabase key.');
  process.exit(1);
}

if (apply && !writeKey) {
  console.error('Real migration requires SUPABASE_SERVICE_ROLE_KEY. Dry-run works with the anon key.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, apply ? writeKey : readKey);
const backup = [];
const stats = {
  checked: 0,
  skipped: 0,
  ok: 0,
  broken: 0,
  uploaded: 0,
};

function isSupabaseStorageUrl(value) {
  return String(value || '').includes(`/storage/v1/object/public/${bucket}/`);
}

function sanitizeSegment(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return cleaned || fallback;
}

function extensionFromType(contentType) {
  if (contentType.includes('image/webp')) return 'webp';
  if (contentType.includes('image/png')) return 'png';
  if (contentType.includes('image/gif')) return 'gif';
  if (contentType.includes('image/avif')) return 'avif';
  return 'jpg';
}

async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(bucket);
  if (data) return;

  const { error } = await supabase.storage.createBucket(bucket, {
    public: true,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    fileSizeLimit: maxBytes,
  });

  if (error) throw error;
}

async function fetchImage(sourceUrl) {
  let response;

  try {
    response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(fetchTimeoutMs),
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      },
    });
  } catch {
    return { ok: false, status: 'timeout', contentType: '' };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.startsWith('image/')) {
    return { ok: false, status: response.status, contentType };
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    return { ok: false, status: 413, contentType };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    return { ok: false, status: 413, contentType };
  }

  return { ok: true, contentType, buffer };
}

async function markBroken(product, sourceUrl) {
  stats.broken += 1;
  if (!apply) return;

  const { error } = await supabase
    .from('products')
    .update({
      source_thumbnail_url: sourceUrl,
      image_status: 'broken',
      image_checked_at: new Date().toISOString(),
    })
    .eq('id', product.id);

  if (error) throw error;
}

async function migrateProduct(product) {
  const sourceUrl = product.source_thumbnail_url || product.thumbnail_url;

  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    stats.skipped += 1;
    return;
  }

  if (isSupabaseStorageUrl(product.thumbnail_url) && product.image_status === 'ok' && !retryBroken) {
    stats.skipped += 1;
    return;
  }

  if (product.image_status === 'broken' && !retryBroken) {
    stats.skipped += 1;
    return;
  }

  stats.checked += 1;
  const image = await fetchImage(sourceUrl);

  if (!image.ok) {
    console.log(`broken ${product.id} ${product.sku || ''} ${image.status} ${product.name}`);
    await markBroken(product, sourceUrl);
    return;
  }

  stats.ok += 1;
  if (!apply) return;

  const ext = extensionFromType(image.contentType);
  const sku = sanitizeSegment(product.sku, String(product.id));
  const storagePath = `products/${sku}-${product.id}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, image.buffer, {
      contentType: image.contentType,
      cacheControl: '31536000',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const newUrl = publicData.publicUrl;

  const { error: updateError } = await supabase
    .from('products')
    .update({
      thumbnail_url: newUrl,
      source_thumbnail_url: sourceUrl,
      image_storage_path: storagePath,
      image_status: 'ok',
      image_checked_at: new Date().toISOString(),
    })
    .eq('id', product.id);

  if (updateError) throw updateError;

  backup.push({
    id: product.id,
    sku: product.sku,
    old_thumbnail_url: product.thumbnail_url,
    new_thumbnail_url: newUrl,
    source_thumbnail_url: sourceUrl,
    image_storage_path: storagePath,
  });
  stats.uploaded += 1;
  console.log(`uploaded ${product.id} ${product.sku || ''}`);
}

if (apply) {
  await ensureBucket();
}

async function loadProducts() {
  let query = supabase
    .from('products')
    .select('id, name, sku, thumbnail_url, source_thumbnail_url, image_status')
    .order('number_sites', { ascending: true });

  if (limit > 0) query = query.limit(limit);

  const extended = await query;
  if (!extended.error) return extended.data || [];

  if (apply) {
    console.error(extended.error.message);
    console.error('Apply supabase/migrations/20260706000000_product_images_storage.sql before running --apply.');
    process.exit(1);
  }

  let fallback = supabase
    .from('products')
    .select('id, name, sku, thumbnail_url')
    .order('number_sites', { ascending: true });

  if (limit > 0) fallback = fallback.limit(limit);

  const basic = await fallback;
  if (basic.error) {
    console.error(basic.error.message);
    process.exit(1);
  }

  return (basic.data || []).map((product) => ({
    ...product,
    source_thumbnail_url: null,
    image_status: 'pending',
  }));
}

const products = await loadProducts();

for (let index = 0; index < products.length; index += concurrency) {
  const batch = products.slice(index, index + concurrency);
  await Promise.all(
    batch.map(async (product) => {
      try {
        await migrateProduct(product);
      } catch (error) {
        stats.broken += 1;
        console.error(`failed ${product.id} ${product.sku || ''}: ${error.message}`);
      }
    })
  );
}

if (apply && backup.length > 0) {
  const backupDir = path.join('scripts', 'image-migration-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(backupDir, `product-images-${stamp}.json`),
    JSON.stringify(backup, null, 2)
  );
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  bucket,
  concurrency,
  fetchTimeoutMs,
  ...stats,
}, null, 2));
