import { createClient } from "@supabase/supabase-js";

const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseSvcKey  = import.meta.env.VITE_SUPABASE_SERVICE_ROLE;

/**
 * Public (anon) client — used for all regular reads that respect RLS.
 */
export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

/**
 * Admin client — uses the service role key to bypass RLS.
 * Use ONLY for privileged writes (e.g., permissions table upsert).
 * Never expose this key to end-users or logs.
 */
export const supabaseAdmin = createClient(supabaseUrl ?? "", supabaseSvcKey ?? "", {
  auth: { 
    persistSession: false, 
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "sb-admin-empty-token"
  }
});
