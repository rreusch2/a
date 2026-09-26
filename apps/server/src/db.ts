import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSupabaseConfigured, env } from './env.js';

export function createUserClient(accessToken: string): SupabaseClient {
  assertSupabaseConfigured();
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAdminClient(): SupabaseClient {
  assertSupabaseConfigured();
  return createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
