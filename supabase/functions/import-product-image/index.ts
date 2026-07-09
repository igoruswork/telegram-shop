import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const bucket = Deno.env.get('PRODUCT_IMAGE_BUCKET') || 'product-images';
const maxBytes = Number(Deno.env.get('PRODUCT_IMAGE_MAX_BYTES') || 5 * 1024 * 1024);
const imageScale = Number(Deno.env.get('PRODUCT_IMAGE_RESIZE_SCALE') || 0.7);
const minImageWidth = Number(Deno.env.get('PRODUCT_IMAGE_MIN_WIDTH') || 560);
const fallbackImageWidth = Number(Deno.env.get('PRODUCT_IMAGE_FALLBACK_WIDTH') || 700);
const imageQuality = Number(Deno.env.get('PRODUCT_IMAGE_QUALITY') || 78);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function sanitizeSegment(value: unknown, fallback: string) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return cleaned || fallback;
}

function extensionFromType(contentType: string) {
  if (contentType.includes('image/webp')) return 'webp';
  if (contentType.includes('image/png')) return 'png';
  if (contentType.includes('image/gif')) return 'gif';
  if (contentType.includes('image/avif')) return 'avif';
  return 'jpg';
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint16Be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32Be(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function isJpegSofMarker(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function getImageDimensions(bytes: Uint8Array, contentType: string) {
  try {
    if (contentType.includes('image/png') && bytes.length >= 24) {
      return {
        width: readUint32Be(bytes, 16),
        height: readUint32Be(bytes, 20),
      };
    }

    if (contentType.includes('image/gif') && bytes.length >= 10) {
      return {
        width: readUint16Le(bytes, 6),
        height: readUint16Le(bytes, 8),
      };
    }

    if (contentType.includes('image/jpeg') && bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        const marker = bytes[offset + 1];
        const length = readUint16Be(bytes, offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) break;

        if (isJpegSofMarker(marker)) {
          return {
            height: readUint16Be(bytes, offset + 5),
            width: readUint16Be(bytes, offset + 7),
          };
        }

        offset += 2 + length;
      }
    }

    if (contentType.includes('image/webp') && bytes.length > 30 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP') {
      const chunk = readAscii(bytes, 12, 4);
      if (chunk === 'VP8X' && bytes.length >= 30) {
        return {
          width: readUint24Le(bytes, 24) + 1,
          height: readUint24Le(bytes, 27) + 1,
        };
      }

      if (chunk === 'VP8 ' && bytes.length >= 30) {
        return {
          width: readUint16Le(bytes, 26) & 0x3fff,
          height: readUint16Le(bytes, 28) & 0x3fff,
        };
      }

      if (chunk === 'VP8L' && bytes.length >= 25) {
        const b0 = bytes[21];
        const b1 = bytes[22];
        const b2 = bytes[23];
        const b3 = bytes[24];
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

function getOptimizedWidth(bytes: Uint8Array, contentType: string) {
  const dimensions = getImageDimensions(bytes, contentType);
  const originalWidth = dimensions?.width || 0;

  if (!Number.isFinite(originalWidth) || originalWidth <= 0) {
    return fallbackImageWidth;
  }

  const scaledWidth = Math.round(originalWidth * imageScale);
  return Math.min(originalWidth, Math.max(minImageWidth, scaledWidth));
}

function buildOptimizedImageUrl(supabaseUrl: string, storagePath: string, width: number) {
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

async function markBroken(supabase: ReturnType<typeof createClient>, productId: number, sourceUrl: string) {
  await supabase
    .from('products')
    .update({
      source_thumbnail_url: sourceUrl,
      image_status: 'broken',
      image_checked_at: new Date().toISOString(),
    })
    .eq('id', productId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Supabase service credentials are not configured.' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => ({}));
  const productId = Number(body.productId);
  const sourceUrl = String(body.sourceUrl || '').trim();

  if (!Number.isInteger(productId) || productId <= 0 || !sourceUrl) {
    return json({ error: 'productId and sourceUrl are required.' }, 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    await markBroken(supabase, productId, sourceUrl);
    return json({ error: 'sourceUrl is not a valid URL.' }, 400);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    await markBroken(supabase, productId, sourceUrl);
    return json({ error: 'sourceUrl must be http or https.' }, 400);
  }

  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      },
    });
  } catch {
    await markBroken(supabase, productId, sourceUrl);
    return json({ error: 'Could not fetch source image.' }, 502);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok || !contentType.startsWith('image/')) {
    await markBroken(supabase, productId, sourceUrl);
    return json({ error: `Source image is not available: ${response.status}.` }, 502);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    await markBroken(supabase, productId, sourceUrl);
    return json({ error: 'Source image is too large.' }, 413);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    await markBroken(supabase, productId, sourceUrl);
    return json({ error: 'Source image is too large.' }, 413);
  }

  const sku = sanitizeSegment(body.sku, String(productId));
  const ext = extensionFromType(contentType);
  const storagePath = `products/${sku}-${productId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, {
      contentType,
      cacheControl: '31536000',
      upsert: true,
    });

  if (uploadError) {
    await markBroken(supabase, productId, sourceUrl);
    return json({ error: uploadError.message }, 500);
  }

  const optimizedWidth = getOptimizedWidth(bytes, contentType);
  const publicUrl = buildOptimizedImageUrl(supabaseUrl, storagePath, optimizedWidth);

  const { data: product, error: updateError } = await supabase
    .from('products')
    .update({
      thumbnail_url: publicUrl,
      source_thumbnail_url: sourceUrl,
      image_storage_path: storagePath,
      image_status: 'ok',
      image_checked_at: new Date().toISOString(),
    })
    .eq('id', productId)
    .select('id, name, category, p_category, badge, view, number_sites, sku, price, thumbnail_url')
    .single();

  if (updateError) {
    return json({ error: updateError.message }, 500);
  }

  return json({
    product,
    source_thumbnail_url: sourceUrl,
    image_storage_path: storagePath,
    optimized_width: optimizedWidth,
  });
});
