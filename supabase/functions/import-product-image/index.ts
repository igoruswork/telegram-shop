import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const bucket = Deno.env.get('PRODUCT_IMAGE_BUCKET') || 'product-images';
const maxBytes = Number(Deno.env.get('PRODUCT_IMAGE_MAX_BYTES') || 5 * 1024 * 1024);

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

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;

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
  });
});
