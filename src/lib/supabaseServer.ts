import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = (process as any).env.SUPABASE_URL;
  // Prefer official name; fall back to our legacy var if present
  const key =
    (process as any).env.SUPABASE_SECRET ||
    (process as any).env.SUPABASE_SECRET_KEY ||
    (process as any).env.SUPABASE_SERVICE_ROLE_KEY ||
    (process as any).env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or Supabase secret key env (SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(url, key, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
}


