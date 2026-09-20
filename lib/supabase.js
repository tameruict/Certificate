import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';

const config = globalThis.CERTLAB_SUPABASE_CONFIG || {};
export const SUPABASE_URL = String(config.url || '');
export const SUPABASE_ANON_KEY = String(config.anonKey || '');
function isBrowserSafeKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadPart = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(atob(payloadPart));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}
export const isSupabaseConfigured = Boolean(
  /^https:\/\/[^/]+\.supabase\.co$/.test(SUPABASE_URL) &&
  isBrowserSafeKey(SUPABASE_ANON_KEY)
);
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    })
  : null;
