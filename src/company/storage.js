// Persistence for the company structure.
// - Local cache in localStorage: instant start and offline fallback.
// - Shared copy in Supabase `app_settings` (key `company_structure`) so every
//   viewer sees the same structure. Needs the migration
//   supabase/migrations/20261110000000_company_structure_settings.sql.
import { createClient } from '@supabase/supabase-js';
import { normalizeDoc } from './model.js';
import seed from './seed.json';

const SETTINGS_KEY = 'company_structure';
const CACHE_KEY = 'company-structure:v1';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const remoteEnabled = Boolean(url && key && !String(key).startsWith('sb_secret_'));
const supabase = remoteEnabled
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export const isRemoteEnabled = remoteEnabled;

export function seedDoc() {
  return normalizeDoc(seed);
}

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.doc) return null;
    return { doc: normalizeDoc(parsed.doc), synced: parsed.synced !== false };
  } catch {
    return null;
  }
}

export function writeCache(doc, synced) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ doc, synced }));
  } catch {
    // Private mode / quota: the page still works for this session.
  }
}

export async function fetchRemote() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_settings')
    .select('value, updated_at')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  if (!data?.value?.nodes) return null;
  return normalizeDoc(data.value);
}

/** Returns 'remote' when shared, 'local' when only cached on this device. */
export async function saveDoc(doc) {
  writeCache(doc, false);
  if (!supabase) return 'local';
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: SETTINGS_KEY, value: doc }, { onConflict: 'key' });
  if (error) {
    console.warn('company_structure save failed:', error);
    return 'local';
  }
  writeCache(doc, true);
  return 'remote';
}
