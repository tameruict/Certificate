import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';

const config = globalThis.CERTLAB_SUPABASE_CONFIG || {};
export const SUPABASE_URL = String(config.url || '');
export const SUPABASE_ANON_KEY = String(config.anonKey || '');
export const isSupabaseConfigured = Boolean(
  /^https:\/\/[^/]+\.supabase\.co$/.test(SUPABASE_URL) &&
  SUPABASE_ANON_KEY &&
  !/^YOUR[_-]/i.test(SUPABASE_ANON_KEY)
);
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;
