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
const imageScale = Number(process.env.PRODUCT_IMAGE_RESIZE_SCALE || 0.7);
const minImageWidth = Number(process.env.PRODUCT_IMAGE_MIN_WIDTH || 560);
const fallbackImageWidth = Number(process.env.PRODUCT_IMAGE_FALLBACK_WIDTH || 700);
const imageQuality = Number(process.env.PRODUCT_IMAGE_QUALITY || 78);

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
  const url = String(value || '');
  return (
    url.includes(`/storage/v1/object/public/${bucket}/`) ||
    url.includes(`/storage/v1/render/image/public/${bucket}/`)
  );
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

function readAscii(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('ascii');
}

function readUint24Le(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function isJpegSofMarker(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function getImageDimensions(buffer, contentType) {
  try {
    if (contentType.includes('image/png') && buffer.length >= 24) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }

    if (contentType.includes('image/gif') && buffer.length >= 10) {
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
      };
    }

    if (contentType.includes('image/jpeg') && buffer.length > 12 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > buffer.length) break;

        if (isJpegSofMarker(marker)) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }

        offset += 2 + length;
      }
    }

    if (contentType.includes('image/webp') && buffer.length > 30 && readAscii(buffer, 0, 4) === 'RIFF' && readAscii(buffer, 8, 4) === 'WEBP') {
      const chunk = readAscii(buffer, 12, 4);
      if (chunk === 'VP8X' && buffer.length >= 30) {
        return {
          width: readUint24Le(buffer, 24) + 1,
          height: readUint24Le(buffer, 27) + 1,
        };
      }

      if (chunk === 'VP8 ' && buffer.length >= 30) {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }

      if (chunk === 'VP8L' && buffer.length >= 25) {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        return {
          width: 1 + b0 + ((b1 & 0x3f) << 8),
          height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getOptimizedWidth(buffer, contentType) {
  const dimensions = getImageDimensions(buffer, contentType);
  const originalWidth = dimensions?.width || 0;

  if (!Number.isFinite(originalWidth) || originalWidth <= 0) {
    return fallbackImageWidth;
  }

  const scaledWidth = Math.round(originalWidth * imageScale);
  return Math.min(originalWidth, Math.max(minImageWidth, scaledWidth));
}

function buildOptimizedImageUrl(storagePath, width) {
  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams({
    width: String(width),
    resize: 'contain',
    quality: String(imageQuality),
  });

  return `${baseUrl}/storage/v1/render/image/public/${encodedBucket}/${encodedPath}?${params.toString()}`;
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

  const optimizedWidth = getOptimizedWidth(image.buffer, image.contentType);
  const newUrl = buildOptimizedImageUrl(storagePath, optimizedWidth);

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
